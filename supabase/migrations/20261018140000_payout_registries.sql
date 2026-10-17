-- Этап 2, шаг 18: реестры выплат и авансы.
-- ТЗ: раздел 15 (В-1, В-3, В-10), раздел 5 (сущности «Реестр выплат», «Строка реестра», «Аванс исполнителю»).
--
-- Реестр собирается одной кнопкой из утверждённых начислений, сам делится на каналы (самозанятые — платформа, остальные — банк)
-- и уходит только после подтверждения вторым человеком. Кто не прошёл допуск (шаг 17), попадает в список исключений с причиной.
-- Аванс удерживается из следующей выплаты. Отправку в банк и на платформу, сверку и ошибки делает шаг 19.

-- ============================================================
-- 1. Настройки и события
-- ============================================================
INSERT INTO public.setting_definitions
  (key, group_name, label, description, value_type, default_value, nullable, unit, min_value, max_value, allowed_values, levels, needs_confirmation, sort_order)
VALUES
  ('advance.max_pct', 'Деньги', 'Максимальный аванс', 'Аванс не больше этой доли уже начисленного исполнителю за текущий месяц, с учётом ещё не удержанных авансов',
   'number', '50', false, '%', 1, 100, NULL, ARRAY['org'], true, 83);

INSERT INTO public.notification_events (code, title, channels, delivery, critical, audience) VALUES
  ('registry_pending',  'Реестр выплат ждёт подтверждения',  ARRAY['max'],    'all', false, 'руководитель'),
  ('advance_requested', 'Запрос аванса от исполнителя',      ARRAY[]::text[], 'all', false, 'бухгалтер');

-- ============================================================
-- 2. Авансы
-- ============================================================
CREATE TABLE public.worker_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  -- Сколько ещё предстоит удержать из выплат; растёт обратно, если реестр с удержанием отменили.
  remaining numeric(14,2) NOT NULL DEFAULT 0 CHECK (remaining >= 0),
  -- Запрошен → Согласован → В реестре → Выдан → Погашен; либо отклонён или отменён.
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'in_registry', 'issued', 'repaid', 'rejected', 'cancelled')),
  requested_by_worker boolean NOT NULL DEFAULT false,
  note text,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reject_reason text,
  issued_at timestamptz,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, worker_id) REFERENCES public.workers (org_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX worker_advances_worker_idx ON public.worker_advances (worker_id, status);
CREATE TRIGGER audit_worker_advances
  AFTER INSERT OR UPDATE ON public.worker_advances
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('worker_id', 'amount', 'remaining', 'status');

-- ============================================================
-- 3. Реестры и строки
-- ============================================================
CREATE TABLE public.payout_registries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Один набор нажатия кнопки: реестры по разным каналам связаны общим идентификатором.
  batch_id uuid NOT NULL,
  number text,
  kind text NOT NULL CHECK (kind IN ('payment', 'advance')),
  channel text NOT NULL CHECK (channel IN ('bank', 'platform')),
  period_from date NOT NULL,
  period_to date NOT NULL,
  -- Сформирован → Подтверждён вторым лицом → Отправлен → Проведён (частично) / Ошибки; либо аннулирован.
  status text NOT NULL DEFAULT 'composed' CHECK (status IN ('composed', 'confirmed', 'sent', 'paid_partial', 'paid', 'errors', 'cancelled')),
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  lines_count integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  sent_at timestamptz,
  cancel_reason text,
  file_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_registries_period CHECK (period_to >= period_from),
  CONSTRAINT payout_registries_cancel_reason CHECK (status <> 'cancelled' OR length(btrim(coalesce(cancel_reason, ''))) > 0)
);

CREATE INDEX payout_registries_org_idx ON public.payout_registries (org_id, status, created_at DESC);
CREATE TRIGGER audit_payout_registries
  AFTER INSERT OR UPDATE ON public.payout_registries
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('number', 'kind', 'channel', 'status', 'total_amount');

CREATE TABLE public.payout_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_id uuid NOT NULL REFERENCES public.payout_registries(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  worker_name text NOT NULL,
  tax_status text,
  -- Начислено исполнителю на руки; удержанный аванс; налоги, которые мы уплачиваем как налоговый агент (для отчёта в 1С);
  -- к перечислению — то, что получит исполнитель.
  gross numeric(14,2) NOT NULL DEFAULT 0,
  advance_held numeric(14,2) NOT NULL DEFAULT 0,
  ndfl numeric(14,2) NOT NULL DEFAULT 0,
  contributions numeric(14,2) NOT NULL DEFAULT 0,
  amount_to_pay numeric(14,2) NOT NULL CHECK (amount_to_pay >= 0),
  requisites_masked text,
  advance_id uuid REFERENCES public.worker_advances(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'error', 'cancelled')),
  provider_payment_id text,
  error_text text,
  receipt text,
  paid_at timestamptz,
  FOREIGN KEY (org_id, worker_id) REFERENCES public.workers (org_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX payout_lines_registry_idx ON public.payout_lines (registry_id);
CREATE INDEX payout_lines_worker_idx ON public.payout_lines (worker_id, status);
CREATE TRIGGER audit_payout_lines
  AFTER INSERT OR UPDATE ON public.payout_lines
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('registry_id', 'worker_id', 'amount_to_pay', 'status');

-- Начисление входит не более чем в одну действующую строку реестра.
ALTER TABLE public.accruals ADD COLUMN payout_line_id uuid REFERENCES public.payout_lines(id) ON DELETE SET NULL;
CREATE INDEX accruals_payout_line_idx ON public.accruals (payout_line_id) WHERE payout_line_id IS NOT NULL;

-- Удержания аванса по строкам: нужны, чтобы вернуть аванс при отмене реестра или ошибке строки.
CREATE TABLE public.advance_deductions (
  line_id uuid NOT NULL REFERENCES public.payout_lines(id) ON DELETE CASCADE,
  advance_id uuid NOT NULL REFERENCES public.worker_advances(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (line_id, advance_id)
);

-- Кого не включили в реестр и почему (В-2).
CREATE TABLE public.payout_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  worker_name text NOT NULL,
  kind text NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  reasons text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payout_exclusions_batch_idx ON public.payout_exclusions (batch_id);

-- Суммы строки не правятся после составления; удалить строку можно только из ещё не подтверждённого реестра (функцией).
CREATE OR REPLACE FUNCTION private.payout_lines_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.registry_id, NEW.worker_id, NEW.gross, NEW.advance_held, NEW.ndfl, NEW.contributions, NEW.amount_to_pay, NEW.advance_id)
       IS DISTINCT FROM (OLD.registry_id, OLD.worker_id, OLD.gross, OLD.advance_held, OLD.ndfl, OLD.contributions, OLD.amount_to_pay, OLD.advance_id) THEN
      RAISE EXCEPTION 'Суммы строки реестра не правятся' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;
  IF coalesce(current_setting('app.payout_internal', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Строку реестра удаляют только функцией' USING ERRCODE = '22023';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER payout_lines_guard BEFORE UPDATE OR DELETE ON public.payout_lines FOR EACH ROW EXECUTE FUNCTION private.payout_lines_guard();

-- ============================================================
-- 4. Аванс по запросу или решению менеджера (В-10)
-- ============================================================
-- Лимит аванса: доля уже начисленного за текущий месяц (ещё не выплаченного) минус открытые авансы.
CREATE OR REPLACE FUNCTION private.advance_room(_worker_id uuid)
RETURNS TABLE (accrued numeric, open_advances numeric, room numeric, pct numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  org uuid;
BEGIN
  SELECT org_id INTO org FROM public.workers WHERE user_id = _worker_id;
  pct := coalesce(public.get_setting_numeric(org, 'advance.max_pct'), 50);
  SELECT coalesce(sum(amount_worker), 0) INTO accrued FROM public.accruals
   WHERE worker_id = _worker_id AND status IN ('approved', 'in_registry') AND date_trunc('month', shift_date) = date_trunc('month', current_date);
  SELECT coalesce(sum(CASE WHEN status = 'issued' THEN remaining ELSE amount END), 0) INTO open_advances FROM public.worker_advances
   WHERE worker_id = _worker_id AND status IN ('requested', 'approved', 'in_registry', 'issued');
  room := greatest(accrued * pct / 100 - open_advances, 0);
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_limit(_worker_id uuid)
RETURNS TABLE (accrued numeric, open_advances numeric, room numeric, pct numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  org uuid;
BEGIN
  SELECT org_id INTO org FROM public.workers WHERE user_id = _worker_id;
  IF org IS NULL OR auth.uid() IS NULL OR NOT (auth.uid() = _worker_id OR private.permission_scope(auth.uid(), org, 'payout_registries', 'view') = 'all') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM private.advance_room(_worker_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_advance(_amount numeric, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  w public.workers;
  r record;
  aid uuid;
  u uuid;
BEGIN
  SELECT * INTO w FROM public.workers WHERE user_id = auth.uid();
  IF NOT FOUND OR w.status <> 'active' THEN RAISE EXCEPTION 'Аванс может запросить действующий исполнитель' USING ERRCODE = '42501'; END IF;
  SELECT * INTO r FROM private.advance_room(w.user_id);
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'Укажите сумму аванса' USING ERRCODE = '22023'; END IF;
  IF _amount > r.room THEN
    RAISE EXCEPTION 'Можно запросить не больше % ₽: аванс — до % процентов начисленного за месяц', round(r.room, 2), r.pct USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.worker_advances (org_id, worker_id, amount, status, requested_by_worker, note) VALUES (w.org_id, w.user_id, _amount, 'requested', true, _note)
  RETURNING id INTO aid;
  FOR u IN SELECT DISTINCT user_id FROM public.user_roles WHERE org_id = w.org_id AND role = 'accountant' LOOP
    PERFORM private.notify(w.org_id, u, 'advance_requested', 'Запрос аванса: ' || w.full_name, _amount || ' ₽', '/advances', 'adv:' || aid);
  END LOOP;
  RETURN aid;
END;
$$;

-- Решением менеджера: бухгалтер или руководитель оформляет согласованный аванс сразу.
CREATE OR REPLACE FUNCTION public.create_advance(_worker_id uuid, _amount numeric, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  w public.workers;
  r record;
  aid uuid;
BEGIN
  SELECT * INTO w FROM public.workers WHERE user_id = _worker_id;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), w.org_id, 'payout_registries', 'create') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM private.advance_room(_worker_id);
  IF _amount IS NULL OR _amount <= 0 OR _amount > r.room THEN
    RAISE EXCEPTION 'Аванс не больше % ₽ (% процентов начисленного за месяц)', round(r.room, 2), r.pct USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.worker_advances (org_id, worker_id, amount, status, note, decided_by) VALUES (w.org_id, _worker_id, _amount, 'approved', _note, auth.uid())
  RETURNING id INTO aid;
  RETURN aid;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_advance(_id uuid, _approve boolean, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.worker_advances;
BEGIN
  SELECT * INTO a FROM public.worker_advances WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), a.org_id, 'payout_registries', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF a.status <> 'requested' THEN RAISE EXCEPTION 'Запрос уже рассмотрен' USING ERRCODE = '22023'; END IF;
  IF NOT _approve AND nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Укажите причину отказа' USING ERRCODE = '22023'; END IF;
  UPDATE public.worker_advances SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END, decided_by = auth.uid(),
         reject_reason = CASE WHEN NOT _approve THEN _reason END WHERE id = _id;
END;
$$;

-- ============================================================
-- 5. Сборка реестров
-- ============================================================
-- Одним нажатием: подбирает невыплаченные утверждённые начисления (или одобренные авансы), проверяет допуск каждого исполнителя,
-- удерживает авансы, считает налоги для отчёта и создаёт реестры по каналам. Кто не прошёл — в список исключений.
CREATE OR REPLACE FUNCTION public.build_payout_registries(_org_id uuid, _from date, _to date, _kind text DEFAULT 'payment')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  batch uuid := gen_random_uuid();
  yr integer := extract(year FROM current_date)::integer;
  c record;
  el record;
  ch text;
  reg_id uuid;
  regs jsonb := '[]'::jsonb;
  excluded integer := 0;
  line_id uuid;
  held numeric;
  to_pay numeric;
  ndfl_sum numeric;
  contrib_sum numeric;
  adv record;
  take numeric;
  reg_ids jsonb := '{}'::jsonb;
  masked text;
  gross numeric;
  seq integer;
  d record;
  u uuid;
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'payout_registries', 'create') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _kind NOT IN ('payment', 'advance') THEN RAISE EXCEPTION 'Неизвестный тип реестра' USING ERRCODE = '22023'; END IF;
  IF _to < _from THEN RAISE EXCEPTION 'Конец периода раньше начала' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.payout_internal', 'on', true);

  IF _kind = 'payment' THEN
    FOR c IN
      SELECT x.worker_id, w.full_name, w.tax_status, sum(x.amount_worker) AS gross, array_agg(x.id) AS accrual_ids
      FROM public.accruals x JOIN public.workers w ON w.user_id = x.worker_id
      WHERE x.org_id = _org_id AND x.status = 'approved' AND x.payout_line_id IS NULL AND x.amount_worker <> 0 AND x.shift_date <= _to
      GROUP BY x.worker_id, w.full_name, w.tax_status ORDER BY w.full_name
    LOOP
      SELECT * INTO el FROM private.payout_eligibility(c.worker_id);
      IF c.gross <= 0 THEN
        INSERT INTO public.payout_exclusions (org_id, batch_id, worker_id, worker_name, kind, amount, reasons)
        VALUES (_org_id, batch, c.worker_id, c.full_name, _kind, c.gross, ARRAY['Нет положительной суммы к выплате: баланс начислений ' || c.gross || ' ₽ переходит на следующий период']);
        excluded := excluded + 1; CONTINUE;
      END IF;
      IF NOT el.eligible THEN
        INSERT INTO public.payout_exclusions (org_id, batch_id, worker_id, worker_name, kind, amount, reasons)
        VALUES (_org_id, batch, c.worker_id, c.full_name, _kind, c.gross, el.reasons);
        excluded := excluded + 1; CONTINUE;
      END IF;

      ch := el.channel;
      IF NOT (reg_ids ? ch) THEN
        seq := private.next_document_number(_org_id, 'payout_registry', yr);
        INSERT INTO public.payout_registries (org_id, batch_id, number, kind, channel, period_from, period_to)
        VALUES (_org_id, batch, 'РВ-' || yr || '/' || seq, _kind, ch, _from, _to) RETURNING id INTO reg_id;
        reg_ids := reg_ids || jsonb_build_object(ch, reg_id);
      END IF;
      reg_id := (reg_ids ->> ch)::uuid;

      -- Налоги, которые мы платим как налоговый агент: по ставкам снимка смены (для отчёта в 1С; исполнитель получает сумму на руки).
      SELECT coalesce(sum(round(x.amount_worker / (1 - (r.tax_snapshot -> w.tax_status ->> 'ndfl_pct')::numeric / 100) - x.amount_worker, 2)), 0),
             coalesce(sum(round(x.amount_worker / (1 - (r.tax_snapshot -> w.tax_status ->> 'ndfl_pct')::numeric / 100)
                                * (r.tax_snapshot -> w.tax_status ->> 'contributions_pct')::numeric / 100, 2)), 0)
        INTO ndfl_sum, contrib_sum
      FROM public.accruals x JOIN public.shift_rates r ON r.shift_id = x.shift_id JOIN public.workers w ON w.user_id = x.worker_id
      WHERE x.id = ANY (c.accrual_ids) AND w.tax_status = 'gph';

      -- Удержание авансов: сначала самые давние
      held := 0;
      FOR adv IN SELECT id, remaining FROM public.worker_advances WHERE worker_id = c.worker_id AND status = 'issued' AND remaining > 0 ORDER BY issued_at, created_at LOOP
        EXIT WHEN held >= c.gross;
        take := least(adv.remaining, c.gross - held);
        held := held + take;
      END LOOP;
      to_pay := c.gross - held;

      SELECT details_masked INTO masked FROM public.payout_requisites WHERE worker_id = c.worker_id AND status = 'confirmed';
      INSERT INTO public.payout_lines (registry_id, org_id, worker_id, worker_name, tax_status, gross, advance_held, ndfl, contributions, amount_to_pay, requisites_masked)
      VALUES (reg_id, _org_id, c.worker_id, c.full_name, c.tax_status, c.gross, held, ndfl_sum, contrib_sum, to_pay, masked) RETURNING id INTO line_id;

      UPDATE public.accruals SET payout_line_id = line_id, status = 'in_registry' WHERE id = ANY (c.accrual_ids);

      held := 0;
      FOR adv IN SELECT id, remaining FROM public.worker_advances WHERE worker_id = c.worker_id AND status = 'issued' AND remaining > 0 ORDER BY issued_at, created_at LOOP
        EXIT WHEN held >= c.gross;
        take := least(adv.remaining, c.gross - held);
        INSERT INTO public.advance_deductions (line_id, advance_id, amount) VALUES (line_id, adv.id, take);
        UPDATE public.worker_advances SET remaining = remaining - take, status = CASE WHEN remaining - take = 0 THEN 'repaid' ELSE status END WHERE id = adv.id;
        held := held + take;
      END LOOP;
    END LOOP;
  ELSE
    -- Реестр аванса: одобренные авансы, у которых исполнитель допущен к выплате
    FOR c IN
      SELECT a.id AS advance_id, a.worker_id, a.amount, w.full_name, w.tax_status FROM public.worker_advances a JOIN public.workers w ON w.user_id = a.worker_id
      WHERE a.org_id = _org_id AND a.status = 'approved' ORDER BY w.full_name, a.created_at
    LOOP
      SELECT * INTO el FROM private.payout_eligibility(c.worker_id);
      IF NOT el.eligible THEN
        INSERT INTO public.payout_exclusions (org_id, batch_id, worker_id, worker_name, kind, amount, reasons)
        VALUES (_org_id, batch, c.worker_id, c.full_name, _kind, c.amount, el.reasons);
        excluded := excluded + 1; CONTINUE;
      END IF;
      ch := el.channel;
      IF NOT (reg_ids ? ch) THEN
        seq := private.next_document_number(_org_id, 'payout_registry', yr);
        INSERT INTO public.payout_registries (org_id, batch_id, number, kind, channel, period_from, period_to)
        VALUES (_org_id, batch, 'РВ-' || yr || '/' || seq, _kind, ch, _from, _to) RETURNING id INTO reg_id;
        reg_ids := reg_ids || jsonb_build_object(ch, reg_id);
      END IF;
      reg_id := (reg_ids ->> ch)::uuid;
      SELECT details_masked INTO masked FROM public.payout_requisites WHERE worker_id = c.worker_id AND status = 'confirmed';
      INSERT INTO public.payout_lines (registry_id, org_id, worker_id, worker_name, tax_status, gross, amount_to_pay, requisites_masked, advance_id)
      VALUES (reg_id, _org_id, c.worker_id, c.full_name, c.tax_status, c.amount, c.amount, masked, c.advance_id);
      UPDATE public.worker_advances SET status = 'in_registry' WHERE id = c.advance_id;
    END LOOP;
  END IF;

  -- Итоги реестров
  UPDATE public.payout_registries r SET total_amount = s.total, lines_count = s.cnt
  FROM (SELECT registry_id, sum(amount_to_pay) AS total, count(*)::integer AS cnt FROM public.payout_lines
        WHERE registry_id IN (SELECT id FROM public.payout_registries WHERE batch_id = batch) GROUP BY registry_id) s
  WHERE r.id = s.registry_id;

  FOR d IN SELECT id, number, channel, total_amount, lines_count FROM public.payout_registries WHERE batch_id = batch ORDER BY channel LOOP
    regs := regs || jsonb_build_object('id', d.id, 'number', d.number, 'channel', d.channel, 'total', d.total_amount, 'lines', d.lines_count);
  END LOOP;

  IF jsonb_array_length(regs) > 0 THEN
    FOR u IN SELECT DISTINCT user_id FROM public.user_roles WHERE org_id = _org_id AND role = 'director' LOOP
      PERFORM private.notify(_org_id, u, 'registry_pending', 'Реестр выплат ждёт подтверждения', jsonb_array_length(regs) || ' реестр(ов), исключено: ' || excluded,
                             '/payout-registries', 'reg:' || batch);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('batch_id', batch, 'registries', regs, 'excluded', excluded);
END;
$$;

-- ============================================================
-- 6. Подтверждение, отмена, исключение строки
-- ============================================================
-- Реестр подтверждает не тот, кто его составил (В-3). После подтверждения состав и суммы не меняются.
CREATE OR REPLACE FUNCTION public.confirm_payout_registry(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r public.payout_registries;
BEGIN
  SELECT * INTO r FROM public.payout_registries WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), r.org_id, 'payout_registries', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'composed' THEN RAISE EXCEPTION 'Подтвердить можно только сформированный реестр' USING ERRCODE = '22023'; END IF;
  IF r.created_by = auth.uid() THEN RAISE EXCEPTION 'Реестр подтверждает другой сотрудник: составитель подтвердить его не может' USING ERRCODE = '42501'; END IF;
  IF r.lines_count = 0 THEN RAISE EXCEPTION 'В реестре нет строк' USING ERRCODE = '22023'; END IF;
  UPDATE public.payout_registries SET status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now() WHERE id = _id;
END;
$$;

-- Возврат строки: начисления снова «утверждено», удержанные авансы возвращаются.
CREATE OR REPLACE FUNCTION private.release_payout_line(_line_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  l public.payout_lines;
  d record;
BEGIN
  SELECT * INTO l FROM public.payout_lines WHERE id = _line_id;
  UPDATE public.accruals SET status = 'approved', payout_line_id = NULL WHERE payout_line_id = _line_id AND status IN ('in_registry', 'paid');
  FOR d IN SELECT advance_id, amount FROM public.advance_deductions WHERE line_id = _line_id LOOP
    UPDATE public.worker_advances SET remaining = remaining + d.amount, status = 'issued' WHERE id = d.advance_id;
  END LOOP;
  DELETE FROM public.advance_deductions WHERE line_id = _line_id;
  IF l.advance_id IS NOT NULL THEN
    UPDATE public.worker_advances SET status = 'approved' WHERE id = l.advance_id AND status = 'in_registry';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_payout_registry(_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r public.payout_registries;
  l record;
BEGIN
  SELECT * INTO r FROM public.payout_registries WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), r.org_id, 'payout_registries', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF r.status NOT IN ('composed', 'confirmed') THEN RAISE EXCEPTION 'Аннулировать можно реестр до отправки' USING ERRCODE = '22023'; END IF;
  IF nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Укажите причину' USING ERRCODE = '22023'; END IF;
  FOR l IN SELECT id FROM public.payout_lines WHERE registry_id = _id LOOP PERFORM private.release_payout_line(l.id); END LOOP;
  UPDATE public.payout_lines SET status = 'cancelled' WHERE registry_id = _id AND status = 'pending';
  UPDATE public.payout_registries SET status = 'cancelled', cancel_reason = _reason WHERE id = _id;
END;
$$;

-- Убрать исполнителя из сформированного, но ещё не подтверждённого реестра.
CREATE OR REPLACE FUNCTION public.remove_payout_line(_line_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  l public.payout_lines;
  r public.payout_registries;
BEGIN
  SELECT * INTO l FROM public.payout_lines WHERE id = _line_id;
  SELECT * INTO r FROM public.payout_registries WHERE id = l.registry_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), r.org_id, 'payout_registries', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'composed' THEN RAISE EXCEPTION 'Строку можно убрать только до подтверждения реестра' USING ERRCODE = '22023'; END IF;
  IF nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Укажите причину' USING ERRCODE = '22023'; END IF;
  PERFORM private.release_payout_line(_line_id);
  PERFORM set_config('app.payout_internal', 'on', true);
  DELETE FROM public.payout_lines WHERE id = _line_id;
  INSERT INTO public.payout_exclusions (org_id, batch_id, worker_id, worker_name, kind, amount, reasons)
  VALUES (r.org_id, r.batch_id, l.worker_id, l.worker_name, r.kind, l.amount_to_pay, ARRAY['Убран из реестра вручную: ' || _reason]);
  UPDATE public.payout_registries x SET total_amount = coalesce((SELECT sum(amount_to_pay) FROM public.payout_lines WHERE registry_id = r.id), 0),
         lines_count = (SELECT count(*) FROM public.payout_lines WHERE registry_id = r.id) WHERE x.id = r.id;
END;
$$;

-- ============================================================
-- 7. Итоги по строкам (вызывают каналы выплат на шаге 19)
-- ============================================================
CREATE OR REPLACE FUNCTION private.refresh_registry_status(_registry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  p integer; ok integer; er integer;
BEGIN
  SELECT count(*) FILTER (WHERE status = 'pending'), count(*) FILTER (WHERE status = 'paid'), count(*) FILTER (WHERE status = 'error')
    INTO p, ok, er FROM public.payout_lines WHERE registry_id = _registry_id;
  UPDATE public.payout_registries SET status = CASE
      WHEN p > 0 AND ok > 0 THEN 'paid_partial'
      WHEN p > 0 THEN status
      WHEN er > 0 THEN 'errors'
      ELSE 'paid' END
   WHERE id = _registry_id AND status IN ('sent', 'confirmed', 'paid_partial', 'errors');
END;
$$;

CREATE OR REPLACE FUNCTION private.mark_line_paid(_line_id uuid, _provider_id text DEFAULT NULL, _receipt text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  l public.payout_lines;
BEGIN
  SELECT * INTO l FROM public.payout_lines WHERE id = _line_id FOR UPDATE;
  IF NOT FOUND OR l.status <> 'pending' THEN RETURN; END IF;
  UPDATE public.payout_lines SET status = 'paid', provider_payment_id = _provider_id, receipt = _receipt, paid_at = now(), error_text = NULL WHERE id = _line_id;
  UPDATE public.accruals SET status = 'paid' WHERE payout_line_id = _line_id AND status = 'in_registry';
  -- Выплаченный аванс становится «выдан» и подлежит удержанию из следующей выплаты
  IF l.advance_id IS NOT NULL THEN
    UPDATE public.worker_advances SET status = 'issued', remaining = amount, issued_at = now() WHERE id = l.advance_id;
  END IF;
  PERFORM private.refresh_registry_status(l.registry_id);
END;
$$;

-- Ошибка банка или платформы: сумма возвращается в «к выплате» (начисления снова утверждены), удержанный аванс возвращается.
CREATE OR REPLACE FUNCTION private.mark_line_error(_line_id uuid, _error text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  l public.payout_lines;
BEGIN
  SELECT * INTO l FROM public.payout_lines WHERE id = _line_id FOR UPDATE;
  IF NOT FOUND OR l.status <> 'pending' THEN RETURN; END IF;
  PERFORM private.release_payout_line(_line_id);
  UPDATE public.payout_lines SET status = 'error', error_text = coalesce(nullif(btrim(_error), ''), 'Ошибка при проведении') WHERE id = _line_id;
  PERFORM private.refresh_registry_status(l.registry_id);
END;
$$;

-- Строки реестра для экрана: исполнитель, суммы, статус.
CREATE OR REPLACE FUNCTION public.payout_registry_lines(_registry_id uuid)
RETURNS TABLE (id uuid, worker_id uuid, worker_name text, tax_status text, gross numeric, advance_held numeric, ndfl numeric, contributions numeric,
               amount_to_pay numeric, requisites_masked text, status text, error_text text, receipt text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  org uuid;
BEGIN
  SELECT org_id INTO org FROM public.payout_registries WHERE payout_registries.id = _registry_id;
  IF org IS NULL OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), org, 'payout_registries', 'view') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT l.id, l.worker_id, l.worker_name, l.tax_status, l.gross, l.advance_held, l.ndfl, l.contributions, l.amount_to_pay, l.requisites_masked, l.status, l.error_text, l.receipt
  FROM public.payout_lines l WHERE l.registry_id = _registry_id ORDER BY l.worker_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.advance_limit(uuid), public.request_advance(numeric, text), public.create_advance(uuid, numeric, text),
  public.decide_advance(uuid, boolean, text), public.build_payout_registries(uuid, date, date, text), public.confirm_payout_registry(uuid),
  public.cancel_payout_registry(uuid, text), public.remove_payout_line(uuid, text), public.payout_registry_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_limit(uuid), public.request_advance(numeric, text), public.create_advance(uuid, numeric, text),
  public.decide_advance(uuid, boolean, text), public.build_payout_registries(uuid, date, date, text), public.confirm_payout_registry(uuid),
  public.cancel_payout_registry(uuid, text), public.remove_payout_line(uuid, text), public.payout_registry_lines(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.advance_room(uuid), private.release_payout_line(uuid), private.refresh_registry_status(uuid),
  private.mark_line_paid(uuid, text, text), private.mark_line_error(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.advance_room(uuid), private.release_payout_line(uuid), private.refresh_registry_status(uuid),
  private.mark_line_paid(uuid, text, text), private.mark_line_error(uuid, text) TO service_role;

-- ============================================================
-- 8. Закрытие месяца учитывает выплаты
-- ============================================================
-- Незавершённые реестры периода — предупреждение при закрытии месяца (шаг 16).
CREATE OR REPLACE FUNCTION public.month_close_blockers(_org_id uuid, _month date)
RETURNS TABLE (severity text, code text, title text, cnt integer, link text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  m1 date := date_trunc('month', _month)::date;
  m2 date := (date_trunc('month', _month) + interval '1 month - 1 day')::date;
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'client_documents', 'view') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT x.severity, x.code, x.title, x.cnt, x.link FROM (VALUES
    ('block', 'open_shifts', 'Смены без итога: назначены или на месте, но не отработаны', (
       SELECT count(*)::integer FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id
       WHERE a.org_id = _org_id AND s.shift_date BETWEEN m1 AND m2 AND a.status IN ('assigned', 'confirmed', 'on_site') AND s.end_at < now()), '/planning'),
    ('block', 'no_timesheet', 'Отработанные смены ещё не вошли в табель', (
       SELECT count(*)::integer FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id
       WHERE a.org_id = _org_id AND s.shift_date BETWEEN m1 AND m2 AND a.status = 'worked' AND a.timesheet_id IS NULL), '/timesheets'),
    ('block', 'timesheets_open', 'Табели не подтверждены заказчиком', (
       SELECT count(*)::integer FROM public.timesheets t
       WHERE t.org_id = _org_id AND t.period_from <= m2 AND t.period_to >= m1 AND t.status IN ('draft', 'pending')), '/timesheets'),
    ('block', 'disputes', 'Есть нерешённые споры по строкам табеля', (
       SELECT count(*)::integer FROM public.timesheet_disputes d JOIN public.timesheets t ON t.id = d.timesheet_id
       WHERE d.org_id = _org_id AND d.status = 'open' AND t.period_from <= m2 AND t.period_to >= m1), '/timesheets'),
    ('block', 'deductions', 'Удержания ждут согласования руководителя', (
       SELECT count(*)::integer FROM public.accruals x
       WHERE x.org_id = _org_id AND x.shift_date BETWEEN m1 AND m2 AND x.needs_approval AND x.status = 'draft'), '/accruals'),
    ('block', 'not_invoiced', 'Утверждённые начисления не вошли в акт', (
       SELECT count(*)::integer FROM public.accruals x
       WHERE x.org_id = _org_id AND x.shift_date BETWEEN m1 AND m2 AND x.kind <> 'correction' AND x.status = 'approved'
         AND x.client_document_id IS NULL AND x.amount_client <> 0), '/documents'),
    ('block', 'drafts', 'Остались черновики актов и счетов за месяц', (
       SELECT count(*)::integer FROM public.client_documents d
       WHERE d.org_id = _org_id AND d.status = 'draft' AND d.kind IN ('act', 'upd') AND d.period_to BETWEEN m1 AND m2), '/documents'),
    ('warn', 'payments', 'Есть неразнесённые платежи месяца', (
       SELECT count(*)::integer FROM public.client_payments p
       WHERE p.org_id = _org_id AND p.payment_date BETWEEN m1 AND m2 AND p.allocated_amount < p.amount), '/payments'),
    ('warn', 'registries', 'Есть реестры выплат, не доведённые до конца', (
       SELECT count(*)::integer FROM public.payout_registries r
       WHERE r.org_id = _org_id AND r.period_to BETWEEN m1 AND m2 AND r.status IN ('composed', 'confirmed', 'sent', 'paid_partial', 'errors')), '/payout-registries')
  ) AS x(severity, code, title, cnt, link)
  WHERE x.cnt > 0;
END;
$$;

-- ============================================================
-- 9. Доступ
-- ============================================================
ALTER TABLE public.worker_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_registries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advance_deductions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.worker_advances, public.payout_registries, public.payout_lines, public.advance_deductions, public.payout_exclusions FROM anon, authenticated;
GRANT SELECT ON public.worker_advances, public.payout_registries, public.payout_exclusions TO authenticated;
GRANT ALL ON public.worker_advances, public.payout_registries, public.payout_lines, public.advance_deductions, public.payout_exclusions TO service_role;

CREATE POLICY "Registries: accounting view" ON public.payout_registries FOR SELECT TO authenticated
  USING (private.permission_scope(auth.uid(), org_id, 'payout_registries', 'view') = 'all');
CREATE POLICY "Exclusions: accounting view" ON public.payout_exclusions FOR SELECT TO authenticated
  USING (private.permission_scope(auth.uid(), org_id, 'payout_registries', 'view') = 'all');
-- Аванс видит бухгалтерия и сам исполнитель.
CREATE POLICY "Advances: own or accounting" ON public.worker_advances FOR SELECT TO authenticated
  USING (worker_id = auth.uid() OR private.permission_scope(auth.uid(), org_id, 'payout_registries', 'view') = 'all');

-- Строки реестра читает бухгалтерия напрямую; писать в них может только функция.
GRANT SELECT ON public.payout_lines TO authenticated;
CREATE POLICY "Payout lines: accounting view" ON public.payout_lines FOR SELECT TO authenticated
  USING (private.permission_scope(auth.uid(), org_id, 'payout_registries', 'view') = 'all');
