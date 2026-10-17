-- Ставки налогов фиксируются вместе с тарифом смены, а не читаются заново при пересчёте.
-- JSON хранит только проценты; денежные результаты остаются numeric(12,2).
ALTER TABLE public.shift_rates ADD COLUMN IF NOT EXISTS tax_snapshot jsonb;

CREATE OR REPLACE FUNCTION private.shift_tax_snapshot(_org_id uuid, _at date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT jsonb_object_agg(status, jsonb_build_object('ndfl_pct', ndfl_pct,
    'contributions_pct', contributions_pct, 'payout_fee_pct', payout_fee_pct))
  FROM (SELECT DISTINCT ON (status) status, ndfl_pct, contributions_pct, payout_fee_pct
    FROM public.tax_status_rates WHERE org_id = _org_id AND effective_from <= _at
    ORDER BY status, effective_from DESC, id DESC) rates
$$;
REVOKE ALL ON FUNCTION private.shift_tax_snapshot(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.shift_tax_snapshot(uuid, date) TO service_role;

-- Для ещё не выложенного этапа это пустая таблица; для уже созданных смен — доступные ставки на дату смены.
UPDATE public.shift_rates r SET tax_snapshot = private.shift_tax_snapshot(r.org_id, s.shift_date)
FROM public.shifts s WHERE s.id = r.shift_id AND r.tax_snapshot IS NULL;

CREATE OR REPLACE FUNCTION private.capture_shift_taxes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tax_snapshot IS DISTINCT FROM OLD.tax_snapshot THEN
      RAISE EXCEPTION 'Снимок налогов смены неизменяем' USING ERRCODE = '22023';
    END IF;
  ELSE
    NEW.tax_snapshot := private.shift_tax_snapshot(NEW.org_id,
      (SELECT shift_date FROM public.shifts WHERE id = NEW.shift_id));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.capture_shift_taxes() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS capture_shift_taxes ON public.shift_rates;
CREATE TRIGGER capture_shift_taxes BEFORE INSERT OR UPDATE ON public.shift_rates
FOR EACH ROW EXECUTE FUNCTION private.capture_shift_taxes();

CREATE OR REPLACE FUNCTION private.calc_amounts(_org_id uuid, _tax_status text, _worker_amount numeric, _at date, _shift_id uuid)
RETURNS TABLE (o_taxes numeric, o_fee numeric)
LANGUAGE plpgsql STABLE SET search_path = public, private
AS $$
DECLARE
  rates jsonb;
  gross numeric;
BEGIN
  SELECT tax_snapshot -> _tax_status INTO rates FROM public.shift_rates WHERE shift_id = _shift_id AND org_id = _org_id;
  IF rates IS NULL THEN RAISE EXCEPTION 'В снимке смены нет ставок налогового статуса «%»', _tax_status USING ERRCODE = '22023'; END IF;
  gross := _worker_amount / (1 - (rates->>'ndfl_pct')::numeric / 100);
  o_taxes := round(gross - _worker_amount + gross * (rates->>'contributions_pct')::numeric / 100, 2);
  o_fee := round(_worker_amount * (rates->>'payout_fee_pct')::numeric / 100, 2);
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION private.calc_amounts(uuid, text, numeric, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.calc_amounts(uuid, text, numeric, date, uuid) TO service_role;

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
  o_tax_status := coalesce((SELECT tax_status FROM public.accruals WHERE assignment_id = _assignment_id AND kind = 'main'), w.tax_status);

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
  SELECT c.o_taxes, c.o_fee INTO o_taxes, o_fee FROM private.calc_amounts(a.org_id, o_tax_status, o_amount_worker, s.shift_date, s.id) c;
  RETURN NEXT;
END;
$$;

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
                            worker_amt, s.shift_date, s.id) c;

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
  SELECT c.o_taxes, c.o_fee INTO t FROM private.calc_amounts(x.org_id, x.tax_status, coalesce(_worker_delta, 0), x.shift_date, x.shift_id) c;
  INSERT INTO public.accruals (org_id, assignment_id, shift_id, shift_date, site_id, client_id, worker_id, kind, amount_client, amount_worker,
                               tax_status, taxes, payout_fee, visible_to_client, reason_id, note, period_month, status, corrects_id)
  VALUES (x.org_id, x.assignment_id, x.shift_id, x.shift_date, x.site_id, x.client_id, x.worker_id, 'correction',
          coalesce(_client_delta, 0), coalesce(_worker_delta, 0), x.tax_status, t.o_taxes, t.o_fee, x.visible_to_client, _reason_id, _note,
          date_trunc('month', current_date)::date, 'approved', _accrual_id)
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

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
    CROSS JOIN LATERAL private.calc_amounts(sh.org_id, coalesce(w.tax_status, 'self_employed'), round(r.worker_rate * pw.weighted, 2), sh.shift_date, sh.id) t
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

