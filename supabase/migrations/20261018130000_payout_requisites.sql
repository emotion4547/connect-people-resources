-- Этап 2, шаг 17: реквизиты исполнителей и защита самозанятых.
-- ТЗ: раздел 15 (В-2, В-7, В-8, В-9, В-13).
--
-- Выплата возможна только исполнителю, у которого есть подтверждённые реквизиты, нет «стопа выплат», а для самозанятого
-- подтверждён статус в ФНС, не исчерпан годовой лимит дохода и нет недавнего трудового договора с нами. Шаг 18 собирает
-- реестр, опираясь на `private.payout_eligibility`: кто не прошёл, попадает в список исключений с причиной.

-- ============================================================
-- 1. Поля исполнителя и настройки
-- ============================================================
ALTER TABLE public.workers
  -- Дата увольнения из нашей организации по трудовому договору: два года после неё выплаты как самозанятому запрещены (В-9).
  ADD COLUMN employment_ended_on date,
  ADD COLUMN payout_stop boolean NOT NULL DEFAULT false,
  ADD COLUMN payout_stop_reason text,
  -- Статус самозанятого по данным ФНС: проверяется раз в сутки и перед включением в реестр (В-7).
  ADD COLUMN npd_status text NOT NULL DEFAULT 'unknown' CHECK (npd_status IN ('unknown', 'active', 'inactive')),
  ADD COLUMN npd_checked_at timestamptz,
  ADD COLUMN npd_message text,
  ADD CONSTRAINT workers_payout_stop_reason CHECK (NOT payout_stop OR length(btrim(coalesce(payout_stop_reason, ''))) > 0);

CREATE TRIGGER audit_workers_payouts
  AFTER UPDATE OF payout_stop, payout_stop_reason, employment_ended_on, npd_status ON public.workers
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('payout_stop', 'payout_stop_reason', 'employment_ended_on', 'npd_status');

INSERT INTO public.setting_definitions
  (key, group_name, label, description, value_type, default_value, nullable, unit, min_value, max_value, allowed_values, levels, needs_confirmation, sort_order)
VALUES
  ('selfemployed.income_limit', 'Исполнители', 'Годовой лимит дохода самозанятого', 'Выше этой суммы доход облагается как у ИП; после неё выплаты как самозанятому блокируются',
   'number', '2400000', false, '₽', 0, 100000000, NULL, ARRAY['org'], true, 120),
  ('selfemployed.income_warn_pct', 'Исполнители', 'Предупреждение о приближении к лимиту', 'Когда доход самозанятого от нас достигает этой доли лимита, рекрутер и бухгалтер получают предупреждение',
   'number', '80', false, '%', 1, 100, NULL, ARRAY['org'], true, 121),
  ('selfemployed.employment_ban_years', 'Исполнители', 'Запрет самозанятости после трудового договора', 'Бывшему работнику по трудовому договору выплаты как самозанятому запрещены этот срок',
   'number', '2', false, 'лет', 0, 10, NULL, ARRAY['org'], true, 122);

INSERT INTO public.notification_events (code, title, channels, delivery, critical, audience) VALUES
  ('payout_blocked',  'Выплаты исполнителю заблокированы',   ARRAY[]::text[], 'all', true,  'рекрутер, бухгалтер'),
  ('income_limit',    'Самозанятый приближается к лимиту',   ARRAY[]::text[], 'all', false, 'рекрутер, бухгалтер'),
  ('payout_requisites_pending', 'Реквизиты ждут подтверждения', ARRAY[]::text[], 'all', false, 'бухгалтер');

-- ============================================================
-- 2. Реквизиты выплат
-- ============================================================
-- Реквизиты хранятся зашифрованно. Новые реквизиты, присланные самим исполнителем, ждут подтверждения бухгалтера: пока
-- они не подтверждены, выплаты этому исполнителю приостановлены полностью (защита от подмены карты при взломе аккаунта).
CREATE TABLE public.payout_requisites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  worker_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('bank_account', 'bank_card', 'platform')),
  details_encrypted bytea NOT NULL,
  details_masked text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected', 'replaced')),
  submitted_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  reject_reason text,
  FOREIGN KEY (org_id, worker_id) REFERENCES public.workers (org_id, user_id) ON DELETE CASCADE
);

-- Подтверждённые реквизиты у исполнителя одни; ожидающих тоже не больше одних.
CREATE UNIQUE INDEX payout_requisites_one_confirmed ON public.payout_requisites (worker_id) WHERE status = 'confirmed';
CREATE UNIQUE INDEX payout_requisites_one_pending ON public.payout_requisites (worker_id) WHERE status = 'pending';

CREATE TRIGGER audit_payout_requisites
  AFTER INSERT OR UPDATE ON public.payout_requisites
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('worker_id', 'channel', 'details_masked', 'status');

ALTER TABLE public.payout_requisites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payout_requisites FROM anon, authenticated;
GRANT ALL ON public.payout_requisites TO service_role;

-- Ранее введённые реквизиты исполнителей считаются подтверждёнными: их вносил бухгалтер или рекрутер.
INSERT INTO public.payout_requisites (org_id, worker_id, channel, details_encrypted, details_masked, status, decided_at)
SELECT s.org_id, s.subject_id, 'bank_account', s.payout_encrypted, coalesce(s.payout_masked, '••••'), 'confirmed', now()
FROM public.person_secrets s
JOIN public.workers w ON w.user_id = s.subject_id AND w.org_id = s.org_id
WHERE s.subject_type = 'worker' AND s.payout_encrypted IS NOT NULL;

-- Внесение реквизитов. Исполнитель вносит только себе, и они ждут подтверждения. Бухгалтер и руководитель вносят
-- от имени исполнителя, это подтверждённые реквизиты сразу (они же и принимают решения).
CREATE OR REPLACE FUNCTION public.submit_payout_requisites(_worker_id uuid, _channel text, _details text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  w public.workers;
  by_staff boolean;
  rid uuid;
  u uuid;
BEGIN
  SELECT * INTO w FROM public.workers WHERE user_id = _worker_id;
  IF NOT FOUND OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  by_staff := private.permission_scope(auth.uid(), w.org_id, 'worker_payout_details', 'update') = 'all';
  IF auth.uid() <> _worker_id AND NOT by_staff THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF _channel NOT IN ('bank_account', 'bank_card', 'platform') THEN RAISE EXCEPTION 'Неизвестный способ выплаты' USING ERRCODE = '22023'; END IF;
  IF nullif(btrim(coalesce(_details, '')), '') IS NULL OR length(btrim(_details)) < 6 THEN
    RAISE EXCEPTION 'Укажите реквизиты полностью' USING ERRCODE = '22023';
  END IF;

  -- Прежняя заявка, не получившая решения, заменяется новой.
  UPDATE public.payout_requisites SET status = 'replaced', decided_at = now() WHERE worker_id = _worker_id AND status = 'pending';
  IF by_staff AND auth.uid() <> _worker_id THEN
    UPDATE public.payout_requisites SET status = 'replaced', decided_at = now() WHERE worker_id = _worker_id AND status = 'confirmed';
  END IF;
  INSERT INTO public.payout_requisites (org_id, worker_id, channel, details_encrypted, details_masked, status, decided_by, decided_at)
  VALUES (w.org_id, _worker_id, _channel, private.pii_encrypt(btrim(_details)), private.mask_value(_details),
          CASE WHEN by_staff AND auth.uid() <> _worker_id THEN 'confirmed' ELSE 'pending' END,
          CASE WHEN by_staff AND auth.uid() <> _worker_id THEN auth.uid() END, CASE WHEN by_staff AND auth.uid() <> _worker_id THEN now() END)
  RETURNING id INTO rid;

  IF NOT (by_staff AND auth.uid() <> _worker_id) THEN
    FOR u IN SELECT DISTINCT user_id FROM public.user_roles WHERE org_id = w.org_id AND role = 'accountant' LOOP
      PERFORM private.notify(w.org_id, u, 'payout_requisites_pending', 'Реквизиты ждут подтверждения: ' || w.full_name,
                             'Выплаты исполнителю приостановлены до подтверждения', '/payout-requisites', 'req:' || rid);
    END LOOP;
  END IF;
  RETURN rid;
END;
$$;

-- Решение бухгалтера. Подтвердить собственную заявку нельзя: решает второй человек.
CREATE OR REPLACE FUNCTION public.decide_payout_requisites(_id uuid, _approve boolean, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r public.payout_requisites;
BEGIN
  SELECT * INTO r FROM public.payout_requisites WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), r.org_id, 'worker_payout_details', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'Заявка уже рассмотрена' USING ERRCODE = '22023'; END IF;
  IF r.submitted_by = auth.uid() THEN RAISE EXCEPTION 'Свои реквизиты подтверждает другой сотрудник' USING ERRCODE = '42501'; END IF;
  IF NOT _approve AND nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Укажите причину отказа' USING ERRCODE = '22023';
  END IF;
  IF _approve THEN
    UPDATE public.payout_requisites SET status = 'replaced', decided_at = now() WHERE worker_id = r.worker_id AND status = 'confirmed';
    UPDATE public.payout_requisites SET status = 'confirmed', decided_by = auth.uid(), decided_at = now() WHERE id = _id;
  ELSE
    UPDATE public.payout_requisites SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), reject_reason = _reason WHERE id = _id;
  END IF;
END;
$$;

-- Что видит исполнитель о своих реквизитах (без самих значений, только маска).
CREATE OR REPLACE FUNCTION public.my_payout_requisites()
RETURNS TABLE (id uuid, channel text, masked text, status text, submitted_at timestamptz, reject_reason text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT r.id, r.channel, r.details_masked, r.status, r.submitted_at, r.reject_reason FROM public.payout_requisites r
  WHERE r.worker_id = auth.uid() AND r.status IN ('pending', 'confirmed', 'rejected')
    AND (r.status <> 'rejected' OR r.submitted_at = (SELECT max(x.submitted_at) FROM public.payout_requisites x WHERE x.worker_id = auth.uid()))
  ORDER BY r.submitted_at DESC
$$;

-- Очередь бухгалтера и статус реквизитов исполнителя для карточки (маски, без значений).
CREATE OR REPLACE FUNCTION public.payout_requisites_queue(_org_id uuid)
RETURNS TABLE (id uuid, worker_id uuid, worker_name text, channel text, masked text, status text, submitted_at timestamptz, submitted_by_worker boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'worker_payout_details', 'view') = 'none' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.id, r.worker_id, w.full_name, r.channel, r.details_masked, r.status, r.submitted_at, r.submitted_by = r.worker_id
  FROM public.payout_requisites r JOIN public.workers w ON w.user_id = r.worker_id
  WHERE r.org_id = _org_id AND r.status IN ('pending', 'confirmed')
  ORDER BY (r.status = 'pending') DESC, r.submitted_at DESC;
END;
$$;

-- Полные реквизиты для составления файла платежей: только с правом смотреть во всей организации, с записью в журнал.
CREATE OR REPLACE FUNCTION public.reveal_payout_requisites(_worker_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  w public.workers;
  enc bytea;
BEGIN
  SELECT * INTO w FROM public.workers WHERE user_id = _worker_id;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), w.org_id, 'worker_payout_details', 'view') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  SELECT details_encrypted INTO enc FROM public.payout_requisites WHERE worker_id = _worker_id AND status = 'confirmed';
  IF enc IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.audit_log (org_id, actor_id, action, table_name, record_id, field, note)
  VALUES (w.org_id, auth.uid(), 'view', 'payout_requisites', _worker_id::text, 'details', 'открыты реквизиты выплаты');
  RETURN private.pii_decrypt(enc);
END;
$$;

-- Стоп выплат: ставит бухгалтер или руководитель, с причиной.
CREATE OR REPLACE FUNCTION public.set_payout_stop(_worker_id uuid, _stop boolean, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  w public.workers;
BEGIN
  SELECT * INTO w FROM public.workers WHERE user_id = _worker_id;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), w.org_id, 'worker_payout_details', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _stop AND nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Укажите причину остановки выплат' USING ERRCODE = '22023';
  END IF;
  UPDATE public.workers SET payout_stop = _stop, payout_stop_reason = CASE WHEN _stop THEN _reason END WHERE user_id = _worker_id;
END;
$$;

-- Дата увольнения по трудовому договору (В-9) вносится в карточке.
CREATE OR REPLACE FUNCTION public.set_employment_end(_worker_id uuid, _date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  w public.workers;
BEGIN
  SELECT * INTO w FROM public.workers WHERE user_id = _worker_id;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), w.org_id, 'worker_payout_details', 'update') = 'none' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  UPDATE public.workers SET employment_ended_on = _date WHERE user_id = _worker_id;
END;
$$;

-- ============================================================
-- 3. Статус самозанятого (ФНС)
-- ============================================================
-- Проверку делает edge-функция check-npd-status: берёт пачку исполнителей с ИНН (служебная роль), спрашивает открытый сервис
-- ФНС и записывает результат. Если самозанятого сняли с учёта, выплаты блокируются, рекрутеру и бухгалтеру приходит задача.
CREATE OR REPLACE FUNCTION public.list_npd_checks(_limit integer DEFAULT 2, _only uuid[] DEFAULT NULL)
RETURNS TABLE (worker_id uuid, inn text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT w.user_id, private.pii_decrypt(s.inn_encrypted)
  FROM public.workers w
  JOIN public.person_secrets s ON s.subject_type = 'worker' AND s.subject_id = w.user_id AND s.inn_encrypted IS NOT NULL
  WHERE w.tax_status = 'self_employed' AND w.status <> 'not_working'
    AND (w.npd_checked_at IS NULL OR w.npd_checked_at < now() - interval '20 hours' OR (_only IS NOT NULL AND w.user_id = ANY (_only)))
    AND (_only IS NULL OR w.user_id = ANY (_only))
  ORDER BY w.npd_checked_at NULLS FIRST
  LIMIT _limit
$$;

CREATE OR REPLACE FUNCTION public.record_npd_status(_worker_id uuid, _status text, _message text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  w public.workers;
  u uuid;
BEGIN
  IF _status NOT IN ('active', 'inactive', 'unknown') THEN RAISE EXCEPTION 'Неизвестный статус' USING ERRCODE = '22023'; END IF;
  SELECT * INTO w FROM public.workers WHERE user_id = _worker_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.workers SET npd_status = _status, npd_checked_at = now(), npd_message = _message WHERE user_id = _worker_id;
  IF _status = 'inactive' AND w.npd_status IS DISTINCT FROM 'inactive' THEN
    -- Рекрутер получает задачу, бухгалтер и рекрутер — уведомление.
    INSERT INTO public.staff_tasks (org_id, assignee_id, assignee_role, kind, title, due_date, related_type, related_id)
    VALUES (w.org_id, NULL, 'recruiter', 'npd_inactive', 'Самозанятый снят с учёта: ' || w.full_name || ' — выплаты заблокированы, уточните статус',
            current_date, 'worker', _worker_id)
    ON CONFLICT DO NOTHING;
    FOR u IN SELECT DISTINCT user_id FROM public.user_roles WHERE org_id = w.org_id AND role IN ('accountant', 'recruiter') LOOP
      PERFORM private.notify(w.org_id, u, 'payout_blocked', 'Самозанятый снят с учёта: ' || w.full_name,
                             'Выплаты заблокированы до восстановления статуса', '/workers/' || _worker_id, 'npd:' || _worker_id || ':' || current_date);
    END LOOP;
  END IF;
END;
$$;

-- Разрешена ли проверка по запросу из интерфейса (кнопка «Проверить сейчас»).
CREATE OR REPLACE FUNCTION public.npd_check_allowed(_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$ SELECT auth.uid() IS NOT NULL AND private.permission_scope(auth.uid(), _org_id, 'worker_payout_details', 'update') = 'all' $$;

-- ============================================================
-- 4. Лимит дохода самозанятого
-- ============================================================
CREATE OR REPLACE FUNCTION private.worker_year_income(_worker_id uuid, _year integer)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT coalesce(sum(amount_worker), 0) FROM public.accruals
  WHERE worker_id = _worker_id AND status <> 'draft' AND extract(year FROM shift_date)::integer = _year
$$;

-- Раз в сутки: предупреждения о приближении к лимиту и о его исчерпании. Задача и уведомление создаются один раз в год на уровень.
CREATE OR REPLACE FUNCTION private.check_selfemployed_limits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  w record;
  lim numeric;
  warn numeric;
  inc numeric;
  lvl text;
  u uuid;
  n integer := 0;
  jan1 date := date_trunc('year', current_date)::date;
BEGIN
  FOR w IN SELECT user_id, org_id, full_name FROM public.workers WHERE tax_status = 'self_employed' LOOP
    lim := coalesce(public.get_setting_numeric(w.org_id, 'selfemployed.income_limit'), 2400000);
    warn := lim * coalesce(public.get_setting_numeric(w.org_id, 'selfemployed.income_warn_pct'), 80) / 100;
    inc := private.worker_year_income(w.user_id, extract(year FROM current_date)::integer);
    lvl := CASE WHEN inc >= lim THEN 'limit_reached' WHEN inc >= warn THEN 'limit_warning' END;
    CONTINUE WHEN lvl IS NULL;
    INSERT INTO public.staff_tasks (org_id, assignee_id, assignee_role, kind, title, due_date, related_type, related_id)
    VALUES (w.org_id, NULL, 'recruiter', 'selfemployed_' || lvl,
            CASE lvl WHEN 'limit_reached' THEN 'Самозанятый исчерпал годовой лимит: ' ELSE 'Самозанятый приближается к годовому лимиту: ' END || w.full_name || ' (' || round(inc) || ' ₽)',
            jan1, 'worker', w.user_id)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      n := n + 1;
      FOR u IN SELECT DISTINCT user_id FROM public.user_roles WHERE org_id = w.org_id AND role IN ('accountant', 'recruiter') LOOP
        PERFORM private.notify(w.org_id, u, CASE lvl WHEN 'limit_reached' THEN 'payout_blocked' ELSE 'income_limit' END,
                               CASE lvl WHEN 'limit_reached' THEN 'Лимит самозанятого исчерпан: ' ELSE 'Самозанятый приближается к лимиту: ' END || w.full_name,
                               'Доход от нас за год ' || round(inc) || ' из ' || round(lim) || ' ₽', '/workers/' || w.user_id, lvl || ':' || w.user_id || ':' || jan1);
      END LOOP;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- ============================================================
-- 5. Допуск к выплате
-- ============================================================
-- Единое правило для реестра (шаг 18): eligible и причины отказа. Каждая причина — отдельная строка на русском.
CREATE OR REPLACE FUNCTION private.payout_eligibility(_worker_id uuid)
RETURNS TABLE (eligible boolean, channel text, reasons text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  w public.workers;
  r text[] := '{}';
  lim numeric;
  inc numeric;
  ban numeric;
BEGIN
  SELECT * INTO w FROM public.workers WHERE user_id = _worker_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Исполнитель не найден' USING ERRCODE = '22023'; END IF;

  IF w.tax_status IS NULL THEN r := array_append(r, ('Не указан налоговый статус')::text); END IF;
  IF w.payout_stop THEN r := array_append(r, (('Выплаты остановлены: ' || w.payout_stop_reason))::text); END IF;
  IF EXISTS (SELECT 1 FROM public.payout_requisites q WHERE q.worker_id = _worker_id AND q.status = 'pending') THEN
    r := array_append(r, ('Реквизиты изменены и ждут подтверждения бухгалтера')::text);
  ELSIF NOT EXISTS (SELECT 1 FROM public.payout_requisites q WHERE q.worker_id = _worker_id AND q.status = 'confirmed') THEN
    r := array_append(r, ('Нет подтверждённых реквизитов')::text);
  END IF;

  IF w.tax_status = 'self_employed' THEN
    IF w.npd_status = 'inactive' THEN
      r := array_append(r, ('Самозанятый снят с учёта в ФНС')::text);
    ELSIF w.npd_status = 'unknown' OR w.npd_checked_at IS NULL OR w.npd_checked_at < now() - interval '3 days' THEN
      r := array_append(r, ('Статус самозанятого не проверен в ФНС (проверка старше трёх суток)')::text);
    END IF;
    lim := coalesce(public.get_setting_numeric(w.org_id, 'selfemployed.income_limit'), 2400000);
    inc := private.worker_year_income(_worker_id, extract(year FROM current_date)::integer);
    IF inc >= lim THEN r := array_append(r, (('Годовой доход от нас ' || round(inc) || ' ₽ достиг лимита самозанятого ' || round(lim) || ' ₽'))::text); END IF;
    ban := coalesce(public.get_setting_numeric(w.org_id, 'selfemployed.employment_ban_years'), 2);
    IF w.employment_ended_on IS NOT NULL AND w.employment_ended_on > (current_date - make_interval(years => ban::integer)) THEN
      r := array_append(r, (('Работал по трудовому договору менее ' || ban::integer || ' лет назад: выплаты как самозанятому запрещены'))::text);
    END IF;
  END IF;

  eligible := cardinality(r) = 0;
  -- Канал выплаты: самозанятые — через платформу, остальные — через банк.
  channel := CASE WHEN w.tax_status = 'self_employed' THEN 'platform' ELSE 'bank' END;
  reasons := r;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.payout_eligibility(_worker_id uuid)
RETURNS TABLE (eligible boolean, channel text, reasons text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  org uuid;
BEGIN
  SELECT org_id INTO org FROM public.workers WHERE user_id = _worker_id;
  IF org IS NULL OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), org, 'worker_payout_details', 'view') = 'none' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM private.payout_eligibility(_worker_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_payout_requisites(uuid, text, text), public.decide_payout_requisites(uuid, boolean, text),
  public.my_payout_requisites(), public.payout_requisites_queue(uuid), public.reveal_payout_requisites(uuid),
  public.set_payout_stop(uuid, boolean, text), public.set_employment_end(uuid, date), public.npd_check_allowed(uuid),
  public.payout_eligibility(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_payout_requisites(uuid, text, text), public.decide_payout_requisites(uuid, boolean, text),
  public.my_payout_requisites(), public.payout_requisites_queue(uuid), public.reveal_payout_requisites(uuid),
  public.set_payout_stop(uuid, boolean, text), public.set_employment_end(uuid, date), public.npd_check_allowed(uuid),
  public.payout_eligibility(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.list_npd_checks(integer, uuid[]), public.record_npd_status(uuid, text, text),
  private.worker_year_income(uuid, integer), private.check_selfemployed_limits(), private.payout_eligibility(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_npd_checks(integer, uuid[]), public.record_npd_status(uuid, text, text),
  private.worker_year_income(uuid, integer), private.check_selfemployed_limits(), private.payout_eligibility(uuid) TO service_role;
