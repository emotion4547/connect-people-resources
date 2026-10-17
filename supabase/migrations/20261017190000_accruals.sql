-- Этап 1, шаг 10: начисления и маржа.
-- ТЗ: раздел 11 (Д-1…Д-7), раздел 5 (сущность «Начисление»).
--
-- Каждая подтверждённая строка табеля даёт основное начисление: сумму заказчику и сумму исполнителю по
-- снимку тарифа на смене. Налоги, взносы и комиссия выплаты считаются по налоговому статусу исполнителя.
-- Акты и выплаты — этап 2: здесь деньги только считаются и показываются.

-- ============================================================
-- 1. Справочники причин
-- ============================================================
ALTER TABLE public.directories DROP CONSTRAINT directories_kind_check;
ALTER TABLE public.directories ADD CONSTRAINT directories_kind_check CHECK (kind IN (
  'worker_group', 'candidate_source', 'client_source',
  'no_show_reason', 'cancel_reason', 'candidate_reject_reason', 'holiday', 'document_type',
  'bonus_reason', 'deduction_reason'
));

CREATE OR REPLACE FUNCTION private.seed_accrual_reasons(_org_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$
  INSERT INTO public.directories (org_id, kind, name, sort_order) VALUES
    (_org_id, 'bonus_reason', 'Премия за качество работы', 1),
    (_org_id, 'bonus_reason', 'Срочный выход', 2),
    (_org_id, 'bonus_reason', 'Работа сверх плана', 3),
    (_org_id, 'deduction_reason', 'Порча имущества', 1),
    (_org_id, 'deduction_reason', 'Недостача', 2),
    (_org_id, 'deduction_reason', 'Нарушение требований объекта', 3),
    (_org_id, 'deduction_reason', 'Опоздание', 4)
  ON CONFLICT DO NOTHING
$$;

CREATE OR REPLACE FUNCTION private.organizations_seed_accrual_reasons()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM private.seed_accrual_reasons(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_seed_accrual_reasons
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.organizations_seed_accrual_reasons();

REVOKE EXECUTE ON FUNCTION private.seed_accrual_reasons(uuid), private.organizations_seed_accrual_reasons() FROM PUBLIC, anon, authenticated;
SELECT private.seed_accrual_reasons(id) FROM public.organizations;

-- ============================================================
-- 2. Начисления
-- ============================================================
CREATE TABLE public.accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE RESTRICT,
  shift_id uuid NOT NULL,
  shift_date date NOT NULL,
  site_id uuid NOT NULL,
  client_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  -- Основное / бонус / удержание / штраф заказчику / корректировка (раздел 5).
  kind text NOT NULL CHECK (kind IN ('main', 'bonus', 'deduction', 'client_penalty', 'correction')),
  unit text,
  -- Часы (или смены) как есть, часы к выставлению и к выплате после минимума и коэффициентов.
  quantity numeric(10,2),
  billable_quantity numeric(10,2),
  payable_quantity numeric(10,2),
  client_rate numeric(12,2),
  worker_rate numeric(12,2),
  -- Средний коэффициент (ночные, праздничные, переработка): для показа, суммы считаются по часам.
  coef numeric(8,4) NOT NULL DEFAULT 1,
  -- Суммы со знаком: удержание отрицательное.
  amount_client numeric(14,2) NOT NULL DEFAULT 0,
  amount_worker numeric(14,2) NOT NULL DEFAULT 0,
  tax_status text NOT NULL CHECK (tax_status IN ('ip', 'self_employed', 'gph', 'employment')),
  taxes numeric(14,2) NOT NULL DEFAULT 0,
  payout_fee numeric(14,2) NOT NULL DEFAULT 0,
  margin numeric(14,2) GENERATED ALWAYS AS (amount_client - amount_worker - taxes - payout_fee) STORED,
  visible_to_client boolean NOT NULL DEFAULT false,
  reason_id uuid REFERENCES public.directories(id) ON DELETE RESTRICT,
  note text,
  period_month date NOT NULL,
  -- Черновик → Утверждено → В акте → В реестре → Выплачено. Последние три ставит этап 2.
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('draft', 'approved', 'in_act', 'in_registry', 'paid')),
  needs_approval boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  corrects_id uuid REFERENCES public.accruals(id) ON DELETE RESTRICT,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, site_id) REFERENCES public.sites (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE RESTRICT,
  CONSTRAINT accruals_signs CHECK (
    (kind = 'bonus' AND amount_worker >= 0) OR (kind = 'deduction' AND amount_worker <= 0)
    OR (kind = 'client_penalty' AND amount_client >= 0) OR kind IN ('main', 'correction')),
  CONSTRAINT accruals_manual_needs_reason CHECK (kind IN ('main') OR reason_id IS NOT NULL),
  CONSTRAINT accruals_correction_links CHECK ((kind = 'correction') = (corrects_id IS NOT NULL))
);

-- На одно назначение — одно основное начисление.
CREATE UNIQUE INDEX accruals_one_main ON public.accruals (assignment_id) WHERE kind = 'main';
CREATE INDEX accruals_shift_idx ON public.accruals (shift_id);
CREATE INDEX accruals_worker_period_idx ON public.accruals (org_id, worker_id, shift_date);
CREATE INDEX accruals_client_period_idx ON public.accruals (org_id, client_id, shift_date);

CREATE TRIGGER audit_accruals
  AFTER INSERT OR UPDATE OR DELETE ON public.accruals
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('assignment_id', 'kind', 'amount_client', 'amount_worker', 'taxes', 'payout_fee', 'status');

-- Суммы неизменны: пересчёт возможен только функцией `recalculate_accrual` (Д-4), дальше — корректировка.
-- Удалить можно только черновик.
CREATE OR REPLACE FUNCTION private.accruals_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Начисление нельзя удалить: оформите корректировку' USING ERRCODE = '22023';
    END IF;
    RETURN OLD;
  END IF;
  IF current_setting('app.accrual_internal', true) = 'on' THEN RETURN NEW; END IF;
  IF (NEW.kind, NEW.amount_client, NEW.amount_worker, NEW.taxes, NEW.payout_fee, NEW.quantity, NEW.billable_quantity,
      NEW.payable_quantity, NEW.client_rate, NEW.worker_rate, NEW.coef, NEW.assignment_id, NEW.tax_status)
     IS DISTINCT FROM
     (OLD.kind, OLD.amount_client, OLD.amount_worker, OLD.taxes, OLD.payout_fee, OLD.quantity, OLD.billable_quantity,
      OLD.payable_quantity, OLD.client_rate, OLD.worker_rate, OLD.coef, OLD.assignment_id, OLD.tax_status) THEN
    RAISE EXCEPTION 'Суммы начисления не правятся: оформите корректировку' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accruals_guard
  BEFORE UPDATE OR DELETE ON public.accruals
  FOR EACH ROW EXECUTE FUNCTION private.accruals_guard();

-- ============================================================
-- 3. Расчёт
-- ============================================================
-- Налоги, взносы и комиссия выплаты с суммы «на руки» (раздел 11): налоги и взносы считаются от суммы
-- «до вычета НДФЛ» (на руки / (1 − НДФЛ)), комиссия — от суммы на руки. Округление — до копеек.
CREATE OR REPLACE FUNCTION private.calc_amounts(_org_id uuid, _tax_status text, _worker_amount numeric, _at date)
RETURNS TABLE (o_taxes numeric, o_fee numeric)
LANGUAGE plpgsql
STABLE
SET search_path = public, private
AS $$
DECLARE
  r public.tax_status_rates;
  gross numeric;
BEGIN
  SELECT * INTO r FROM public.get_tax_rate(_org_id, _tax_status, _at);
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'Не заданы ставки налогов для статуса «%»', _tax_status USING ERRCODE = '22023';
  END IF;
  gross := _worker_amount / (1 - r.ndfl_pct / 100);
  o_taxes := round(gross - _worker_amount + gross * r.contributions_pct / 100, 2);
  o_fee := round(_worker_amount * r.payout_fee_pct / 100, 2);
  RETURN NEXT;
END;
$$;

-- Основное начисление по назначению: часы, коэффициенты, минимум оплачиваемых часов, ставки из снимка (Д-1, Д-2).
--   взвешенные часы = обычные + ночные × коэф. ночи + праздничные × коэф. праздника + утверждённая переработка × (коэф. − 1)
-- Если ночные и праздничные часы вместе превышают часы строки (например, часть строки сняли спором),
-- обе доли уменьшаются пропорционально. Минимум часов применяется, только если человек работал.
CREATE OR REPLACE FUNCTION private.compute_main_amounts(_assignment_id uuid)
RETURNS TABLE (o_unit text, o_quantity numeric, o_billable numeric, o_payable numeric, o_client_rate numeric, o_worker_rate numeric,
               o_coef numeric, o_amount_client numeric, o_amount_worker numeric, o_tax_status text, o_taxes numeric, o_fee numeric)
LANGUAGE plpgsql
STABLE
SET search_path = public, private
AS $$
DECLARE
  a public.assignments;
  s public.shifts;
  rt public.shift_rates;
  w public.workers;
  h numeric;
  n numeric;
  hol numeric;
  ot numeric;
  weighted numeric;
  bq numeric;
  pq numeric;
  scale numeric;
BEGIN
  SELECT * INTO a FROM public.assignments WHERE id = _assignment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Назначение не найдено' USING ERRCODE = '22023'; END IF;
  SELECT * INTO s FROM public.shifts WHERE id = a.shift_id;
  SELECT * INTO rt FROM public.shift_rates WHERE shift_id = a.shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'У смены нет тарифа: подтвердить табель нельзя' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO w FROM public.workers WHERE user_id = a.worker_id;
  IF w.tax_status IS NULL THEN
    RAISE EXCEPTION 'У исполнителя не указан налоговый статус' USING ERRCODE = '22023';
  END IF;
  IF a.approved_hours IS NULL THEN
    RAISE EXCEPTION 'По назначению нет утверждённых часов' USING ERRCODE = '22023';
  END IF;

  h := a.approved_hours;
  o_unit := rt.unit;
  o_client_rate := rt.client_rate;
  o_worker_rate := rt.worker_rate;
  o_tax_status := w.tax_status;

  IF rt.unit = 'hour' THEN
    n := coalesce(a.night_hours, 0);
    hol := coalesce(a.holiday_hours, 0);
    IF n + hol > h AND n + hol > 0 THEN
      scale := h / (n + hol);
      n := n * scale;
      hol := hol * scale;
    END IF;
    ot := least(coalesce(a.overtime_approved_hours, 0), h);
    weighted := (h - n - hol) + n * rt.night_coef + hol * rt.holiday_coef + ot * (rt.overtime_coef - 1);
    bq := CASE WHEN h > 0 THEN greatest(weighted, rt.min_paid_hours) ELSE weighted END;
    pq := CASE WHEN h > 0 AND rt.min_paid_hours_for_worker THEN greatest(weighted, rt.min_paid_hours) ELSE weighted END;
    o_quantity := h;
    o_coef := CASE WHEN h > 0 THEN round(weighted / h, 4) ELSE 1 END;
  ELSE
    -- За смену и за штуку: количество штук приходит корректировкой, здесь — одна единица.
    o_quantity := 1;
    bq := 1;
    pq := 1;
    o_coef := 1;
  END IF;

  o_billable := round(bq, 2);
  o_payable := round(pq, 2);
  o_amount_client := round(bq * rt.client_rate, 2);
  o_amount_worker := round(pq * rt.worker_rate, 2);
  SELECT c.o_taxes, c.o_fee INTO o_taxes, o_fee FROM private.calc_amounts(a.org_id, w.tax_status, o_amount_worker, s.shift_date) c;
  RETURN NEXT;
END;
$$;

-- Вызывается при подтверждении каждой строки табеля (заменяет заглушку шага 9).
CREATE OR REPLACE FUNCTION private.create_accrual_for_assignment(_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.assignments;
  s public.shifts;
  c record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.accruals WHERE assignment_id = _assignment_id AND kind = 'main') THEN RETURN; END IF;
  SELECT * INTO a FROM public.assignments WHERE id = _assignment_id;
  SELECT * INTO s FROM public.shifts WHERE id = a.shift_id;
  SELECT * INTO c FROM private.compute_main_amounts(_assignment_id);
  INSERT INTO public.accruals (org_id, assignment_id, shift_id, shift_date, site_id, client_id, worker_id, kind, unit, quantity,
                               billable_quantity, payable_quantity, client_rate, worker_rate, coef, amount_client, amount_worker,
                               tax_status, taxes, payout_fee, visible_to_client, period_month, status)
  VALUES (a.org_id, _assignment_id, a.shift_id, s.shift_date, s.site_id, s.client_id, a.worker_id, 'main', c.o_unit, c.o_quantity,
          c.o_billable, c.o_payable, c.o_client_rate, c.o_worker_rate, c.o_coef, c.o_amount_client, c.o_amount_worker,
          c.o_tax_status, c.o_taxes, c.o_fee, true, date_trunc('month', s.shift_date)::date, 'approved');
END;
$$;

-- Пересчёт основного начисления до включения в акт или реестр (Д-4). Ставки берутся из снимка на смене,
-- поэтому правка тарифа результат не меняет; пересчёт нужен, когда поменялись часы или налоговая ставка.
CREATE OR REPLACE FUNCTION public.recalculate_accrual(_accrual_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  x public.accruals;
  c record;
BEGIN
  SELECT * INTO x FROM public.accruals WHERE id = _accrual_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT private.row_in_scope(x.org_id, 'accruals', 'update', private.site_row_owners(x.site_id)) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF x.kind <> 'main' OR x.status NOT IN ('draft', 'approved') THEN
    RAISE EXCEPTION 'Пересчитать можно только основное начисление до акта и реестра; дальше — корректировка' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM private.compute_main_amounts(x.assignment_id);
  PERFORM set_config('app.accrual_internal', 'on', true);
  UPDATE public.accruals SET unit = c.o_unit, quantity = c.o_quantity, billable_quantity = c.o_billable, payable_quantity = c.o_payable,
         client_rate = c.o_client_rate, worker_rate = c.o_worker_rate, coef = c.o_coef, amount_client = c.o_amount_client,
         amount_worker = c.o_amount_worker, tax_status = c.o_tax_status, taxes = c.o_taxes, payout_fee = c.o_fee
   WHERE id = _accrual_id;
  PERFORM set_config('app.accrual_internal', 'off', true);
END;
$$;

-- ============================================================
-- 4. Бонусы, удержания, штрафы, корректировки (Д-3, Д-4)
-- ============================================================
-- Бонус и удержание добавляют менеджер объекта или бухгалтер, причина — из справочника. Удержание
-- больше заданной доли начисления за смену (настройка, 30%) ждёт согласования руководителя.
CREATE OR REPLACE FUNCTION public.add_adjustment(_assignment_id uuid, _kind text, _amount numeric, _reason_id uuid,
                                                 _note text DEFAULT NULL, _visible_to_client boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.assignments;
  s public.shifts;
  m public.accruals;
  pct numeric;
  needs boolean := false;
  signed numeric;
  worker_amt numeric := 0;
  client_amt numeric := 0;
  t record;
  new_id uuid;
BEGIN
  SELECT * INTO a FROM public.assignments WHERE id = _assignment_id;
  IF NOT FOUND OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO s FROM public.shifts WHERE id = a.shift_id;
  IF NOT (private.shift_assign_in_scope(a.shift_id, 'update')
          OR private.row_in_scope(a.org_id, 'accruals', 'create', private.site_row_owners(s.site_id))) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _kind NOT IN ('bonus', 'deduction', 'client_penalty') THEN
    RAISE EXCEPTION 'Неизвестный вид начисления' USING ERRCODE = '22023';
  END IF;
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Сумма должна быть больше нуля' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.directories d WHERE d.id = _reason_id AND d.org_id = a.org_id AND d.is_active
                 AND d.kind = CASE _kind WHEN 'bonus' THEN 'bonus_reason' ELSE 'deduction_reason' END) THEN
    RAISE EXCEPTION 'Выберите причину из справочника' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO m FROM public.accruals WHERE assignment_id = _assignment_id AND kind = 'main';
  IF _kind <> 'client_penalty' AND NOT FOUND THEN
    RAISE EXCEPTION 'Основного начисления ещё нет: дождитесь подтверждения табеля' USING ERRCODE = '22023';
  END IF;

  IF _kind = 'bonus' THEN
    signed := _amount; worker_amt := _amount;
  ELSIF _kind = 'deduction' THEN
    signed := -_amount; worker_amt := -_amount;
    pct := coalesce(public.get_setting_numeric(a.org_id, 'accrual.deduction_approval_pct', s.shift_date, s.client_id, s.site_id), 30);
    needs := _amount > m.amount_worker * pct / 100;
  ELSE
    signed := _amount; client_amt := _amount;
  END IF;

  SELECT c.o_taxes, c.o_fee INTO t
  FROM private.calc_amounts(a.org_id, coalesce(m.tax_status, (SELECT w.tax_status FROM public.workers w WHERE w.user_id = a.worker_id)),
                            worker_amt, s.shift_date) c;

  INSERT INTO public.accruals (org_id, assignment_id, shift_id, shift_date, site_id, client_id, worker_id, kind, amount_client, amount_worker,
                               tax_status, taxes, payout_fee, visible_to_client, reason_id, note, period_month, status, needs_approval)
  VALUES (a.org_id, _assignment_id, a.shift_id, s.shift_date, s.site_id, s.client_id, a.worker_id, _kind, client_amt, worker_amt,
          coalesce(m.tax_status, (SELECT w.tax_status FROM public.workers w WHERE w.user_id = a.worker_id)),
          t.o_taxes, t.o_fee, _visible_to_client OR _kind = 'client_penalty', _reason_id, _note,
          date_trunc('month', s.shift_date)::date, CASE WHEN needs THEN 'draft' ELSE 'approved' END, needs)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- Согласование большого удержания — за руководителем.
CREATE OR REPLACE FUNCTION public.approve_accrual(_accrual_id uuid, _approve boolean DEFAULT true)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  x public.accruals;
BEGIN
  SELECT * INTO x FROM public.accruals WHERE id = _accrual_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.has_org_role(auth.uid(), 'director', x.org_id) THEN
    RAISE EXCEPTION 'Согласовывает руководитель' USING ERRCODE = '42501';
  END IF;
  IF NOT x.needs_approval OR x.status <> 'draft' THEN
    RAISE EXCEPTION 'Это начисление не ждёт согласования' USING ERRCODE = '22023';
  END IF;
  IF _approve THEN
    UPDATE public.accruals SET status = 'approved', approved_by = auth.uid(), approved_at = now() WHERE id = _accrual_id;
  ELSE
    DELETE FROM public.accruals WHERE id = _accrual_id;
  END IF;
END;
$$;

-- Корректировка начисления: суммы со знаком, в текущем периоде (закрытый месяц не меняется).
CREATE OR REPLACE FUNCTION public.add_correction(_accrual_id uuid, _client_delta numeric, _worker_delta numeric, _reason_id uuid, _note text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  x public.accruals;
  t record;
  new_id uuid;
BEGIN
  SELECT * INTO x FROM public.accruals WHERE id = _accrual_id;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT private.row_in_scope(x.org_id, 'accruals', 'update', private.site_row_owners(x.site_id)) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF coalesce(_client_delta, 0) = 0 AND coalesce(_worker_delta, 0) = 0 THEN
    RAISE EXCEPTION 'Укажите, на сколько меняется сумма' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(_note, '')), '') IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.directories d WHERE d.id = _reason_id AND d.org_id = x.org_id AND d.kind IN ('bonus_reason', 'deduction_reason')) THEN
    RAISE EXCEPTION 'Укажите причину из справочника и пояснение' USING ERRCODE = '22023';
  END IF;
  SELECT c.o_taxes, c.o_fee INTO t FROM private.calc_amounts(x.org_id, x.tax_status, coalesce(_worker_delta, 0), x.shift_date) c;
  INSERT INTO public.accruals (org_id, assignment_id, shift_id, shift_date, site_id, client_id, worker_id, kind, amount_client, amount_worker,
                               tax_status, taxes, payout_fee, visible_to_client, reason_id, note, period_month, status, corrects_id)
  VALUES (x.org_id, x.assignment_id, x.shift_id, x.shift_date, x.site_id, x.client_id, x.worker_id, 'correction',
          coalesce(_client_delta, 0), coalesce(_worker_delta, 0), x.tax_status, t.o_taxes, t.o_fee, x.visible_to_client, _reason_id, _note,
          date_trunc('month', current_date)::date, 'approved', _accrual_id)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- ============================================================
-- 5. Табель не отправляется, если по строкам нельзя посчитать деньги (Д-1)
-- ============================================================
CREATE OR REPLACE FUNCTION public.send_timesheet(_timesheet_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  t public.timesheets;
  hours numeric;
  deadline timestamptz;
  bad text;
BEGIN
  SELECT * INTO t FROM public.timesheets WHERE id = _timesheet_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.timesheet_in_scope(_timesheet_id, 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF t.status <> 'draft' THEN
    RAISE EXCEPTION 'Отправить можно только черновик' USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(DISTINCT CASE WHEN r.shift_id IS NULL THEN 'нет тарифа на смене ' || sh.shift_date::text
                                  ELSE 'нет налогового статуса у ' || coalesce(w.full_name, 'исполнителя') END, '; ')
    INTO bad
  FROM public.assignments a
  JOIN public.shifts sh ON sh.id = a.shift_id
  LEFT JOIN public.shift_rates r ON r.shift_id = a.shift_id
  LEFT JOIN public.workers w ON w.user_id = a.worker_id
  WHERE a.timesheet_id = _timesheet_id AND (r.shift_id IS NULL OR w.tax_status IS NULL);
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Табель отправить нельзя: %', bad USING ERRCODE = '22023';
  END IF;

  hours := coalesce(public.get_setting_numeric(t.org_id, 'timesheet.autoconfirm_hours', current_date, t.client_id), 48);
  deadline := now() + make_interval(secs => hours * 3600);
  UPDATE public.timesheets SET status = 'pending', sent_at = now(), sent_by = auth.uid(), confirm_deadline = deadline WHERE id = _timesheet_id;
  RETURN deadline;
END;
$$;

-- Автоподтверждение не должно падать целиком из-за одной строки: строка, по которой нельзя посчитать,
-- остаётся неподтверждённой, остальные подтверждаются.
CREATE OR REPLACE FUNCTION private.autoconfirm_timesheets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  t record;
  r record;
  n integer := 0;
BEGIN
  FOR t IN SELECT id FROM public.timesheets WHERE status IN ('pending', 'disputed') AND confirm_deadline <= now() FOR UPDATE LOOP
    FOR r IN SELECT id FROM public.assignments WHERE timesheet_id = t.id AND line_status = 'pending' LOOP
      BEGIN
        PERFORM private.create_accrual_for_assignment(r.id);
        PERFORM set_config('app.timesheet_internal', 'on', true);
        UPDATE public.assignments SET line_status = 'confirmed' WHERE id = r.id;
        PERFORM set_config('app.timesheet_internal', 'off', true);
      EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('app.timesheet_internal', 'off', true);
        RAISE WARNING 'Автоподтверждение: строка % не подтверждена: %', r.id, SQLERRM;
      END;
    END LOOP;
    PERFORM private.refresh_timesheet_status(t.id, true, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- ============================================================
-- 6. Маржа и ведомости (Д-6, Д-7)
-- ============================================================
-- Плановые и фактические суммы по сменам. Плановая маржа считается до табеля: по плановым часам
-- назначенных исполнителей (основной состав), ночные и праздничные часы — по доле в смене.
-- Фактическая — по утверждённым начислениям.
CREATE OR REPLACE FUNCTION public.shift_money(_from date, _to date, _site_id uuid DEFAULT NULL)
RETURNS TABLE (shift_id uuid, order_id uuid, site_id uuid, client_id uuid, shift_date date,
               planned_client numeric, planned_cost numeric, planned_margin numeric,
               actual_client numeric, actual_cost numeric, actual_margin numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH sh AS (
    SELECT s.id, s.order_id, s.site_id, s.client_id, s.shift_date, s.org_id, s.start_at, s.end_at, s.break_minutes, si.timezone
    FROM public.shifts s JOIN public.sites si ON si.id = s.site_id
    WHERE s.shift_date BETWEEN _from AND _to AND (_site_id IS NULL OR s.site_id = _site_id)
      AND s.status <> 'cancelled'
      AND private.row_in_scope(s.org_id, 'accruals', 'view', private.site_row_owners(s.site_id))
  ), plan AS (
    SELECT sh.id AS sid,
           sum(round(r.client_rate * greatest(pw.weighted, r.min_paid_hours), 2)) AS pc,
           sum(round(r.worker_rate * pw.weighted, 2) + t.o_taxes + t.o_fee) AS pcost
    FROM sh
    JOIN public.shift_rates r ON r.shift_id = sh.id AND r.unit = 'hour'
    JOIN public.assignments a ON a.shift_id = sh.id AND NOT a.is_reserve AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked')
    JOIN public.workers w ON w.user_id = a.worker_id
    CROSS JOIN LATERAL private.split_minutes(sh.start_at, sh.end_at, sh.timezone, sh.org_id) sm
    CROSS JOIN LATERAL (SELECT (extract(epoch FROM (sh.end_at - sh.start_at)) / 3600.0 - sh.break_minutes / 60.0) AS h) hh
    CROSS JOIN LATERAL (SELECT hh.h * (1 + (r.night_coef - 1) * sm.night::numeric / nullif(sm.total, 0)
                                         + (r.holiday_coef - 1) * sm.holiday::numeric / nullif(sm.total, 0)) AS weighted) pw
    CROSS JOIN LATERAL private.calc_amounts(sh.org_id, coalesce(w.tax_status, 'self_employed'), round(r.worker_rate * pw.weighted, 2), sh.shift_date) t
    GROUP BY sh.id
  ), act AS (
    SELECT x.shift_id AS sid, sum(x.amount_client) AS ac, sum(x.amount_worker + x.taxes + x.payout_fee) AS acost
    FROM public.accruals x WHERE x.status <> 'draft' AND x.shift_id IN (SELECT id FROM sh) GROUP BY x.shift_id
  )
  SELECT sh.id, sh.order_id, sh.site_id, sh.client_id, sh.shift_date,
         coalesce(plan.pc, 0), coalesce(plan.pcost, 0), coalesce(plan.pc, 0) - coalesce(plan.pcost, 0),
         coalesce(act.ac, 0), coalesce(act.acost, 0), coalesce(act.ac, 0) - coalesce(act.acost, 0)
  FROM sh LEFT JOIN plan ON plan.sid = sh.id LEFT JOIN act ON act.sid = sh.id
  ORDER BY sh.shift_date, sh.id;
END;
$$;

-- Ведомость по исполнителям за период: смены, часы, начислено, бонусы, удержания, к выплате (Д-7).
-- На этапе 2 добавятся «выплачено» и «авансы».
CREATE OR REPLACE FUNCTION public.worker_statement(_from date, _to date)
RETURNS TABLE (worker_id uuid, worker_name text, tax_status text, shifts integer, hours numeric, accrued numeric,
               bonuses numeric, deductions numeric, corrections numeric, to_pay numeric, taxes numeric, payout_fee numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT x.worker_id, w.full_name, w.tax_status,
         (count(DISTINCT x.shift_id) FILTER (WHERE x.kind = 'main'))::integer,
         coalesce(sum(x.quantity) FILTER (WHERE x.kind = 'main'), 0),
         coalesce(sum(x.amount_worker) FILTER (WHERE x.kind = 'main'), 0),
         coalesce(sum(x.amount_worker) FILTER (WHERE x.kind = 'bonus'), 0),
         coalesce(sum(x.amount_worker) FILTER (WHERE x.kind = 'deduction'), 0),
         coalesce(sum(x.amount_worker) FILTER (WHERE x.kind = 'correction'), 0),
         coalesce(sum(x.amount_worker), 0),
         coalesce(sum(x.taxes), 0), coalesce(sum(x.payout_fee), 0)
  FROM public.accruals x
  JOIN public.workers w ON w.user_id = x.worker_id
  WHERE x.shift_date BETWEEN _from AND _to AND x.status <> 'draft'
    AND private.row_in_scope(x.org_id, 'accruals', 'view', private.site_row_owners(x.site_id))
  GROUP BY x.worker_id, w.full_name, w.tax_status
  ORDER BY w.full_name;
END;
$$;

-- Ведомость по заказчикам и объектам: часы, к выставлению, себестоимость, маржа.
CREATE OR REPLACE FUNCTION public.client_statement(_from date, _to date)
RETURNS TABLE (client_id uuid, client_name text, site_id uuid, site_name text, hours numeric, to_invoice numeric,
               payout numeric, taxes_and_fees numeric, cost numeric, margin numeric, margin_pct numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT x.client_id, c.name, x.site_id, si.name,
         coalesce(sum(x.quantity) FILTER (WHERE x.kind = 'main'), 0),
         coalesce(sum(x.amount_client), 0),
         coalesce(sum(x.amount_worker), 0),
         coalesce(sum(x.taxes + x.payout_fee), 0),
         coalesce(sum(x.amount_worker + x.taxes + x.payout_fee), 0),
         coalesce(sum(x.amount_client - x.amount_worker - x.taxes - x.payout_fee), 0),
         CASE WHEN sum(x.amount_client) > 0
              THEN round(sum(x.amount_client - x.amount_worker - x.taxes - x.payout_fee) / sum(x.amount_client) * 100, 1) END
  FROM public.accruals x
  JOIN public.clients c ON c.id = x.client_id
  JOIN public.sites si ON si.id = x.site_id
  WHERE x.shift_date BETWEEN _from AND _to AND x.status <> 'draft'
    AND private.row_in_scope(x.org_id, 'accruals', 'view', private.site_row_owners(x.site_id))
  GROUP BY x.client_id, c.name, x.site_id, si.name
  ORDER BY c.name, si.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recalculate_accrual(uuid), public.add_adjustment(uuid, text, numeric, uuid, text, boolean),
  public.approve_accrual(uuid, boolean), public.add_correction(uuid, numeric, numeric, uuid, text), public.send_timesheet(uuid),
  public.shift_money(date, date, uuid), public.worker_statement(date, date), public.client_statement(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_accrual(uuid), public.add_adjustment(uuid, text, numeric, uuid, text, boolean),
  public.approve_accrual(uuid, boolean), public.add_correction(uuid, numeric, numeric, uuid, text), public.send_timesheet(uuid),
  public.shift_money(date, date, uuid), public.worker_statement(date, date), public.client_statement(date, date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.calc_amounts(uuid, text, numeric, date), private.compute_main_amounts(uuid),
  private.create_accrual_for_assignment(uuid), private.autoconfirm_timesheets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.calc_amounts(uuid, text, numeric, date), private.compute_main_amounts(uuid),
  private.create_accrual_for_assignment(uuid), private.autoconfirm_timesheets() TO service_role;

-- ============================================================
-- 7. Доступ
-- ============================================================
-- Заказчику таблица недоступна: в ней ставки и суммы исполнителя. Он увидит свои суммы через отдельную
-- функцию кабинета (шаг 11), только с пометкой «видно заказчику».
ALTER TABLE public.accruals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accruals FROM anon, authenticated;
GRANT SELECT ON public.accruals TO authenticated;
GRANT ALL ON public.accruals TO service_role;

CREATE POLICY "Accruals: view in scope" ON public.accruals FOR SELECT TO authenticated
  USING (private.row_in_scope(org_id, 'accruals', 'view', private.site_row_owners(site_id)));
