-- Этап 3, шаг 23: платёжный календарь.
-- ТЗ: раздел 16 (Ф-5).
--
-- Аутсорсер платит людям раньше, чем платят заказчики, поэтому кассовый разрыв нужно видеть заранее. Календарь на четыре недели
-- по дням: ожидаемые поступления (неоплаченные счета по срокам оплаты, а также начисления и смены, по которым счёт ещё не выставлен)
-- и выплаты (реестры в работе, начисленное к выплате и смены, которые будут отработаны) против остатка денег.
--
-- Допущения, которые видны в настройках: выплаты уходят раз в неделю в выбранный день, исполнителям платят за смены старше
-- заданного числа дней; поступление по ещё не выставленному — через период выставления и отсрочку по договору.

INSERT INTO public.setting_definitions
  (key, group_name, label, description, value_type, default_value, nullable, unit, min_value, max_value, allowed_values, levels, needs_confirmation, sort_order)
VALUES
  ('payout.weekday', 'Деньги', 'День недели выплат исполнителям', '1 — понедельник … 7 — воскресенье. По этому дню календарь планирует выплаты',
   'number', '5', false, NULL, 1, 7, NULL, ARRAY['org'], true, 84),
  ('payout.lag_days', 'Деньги', 'Выплата за смены старше, дней', 'В очередную дату выплат попадают смены, отработанные не позже, чем за столько дней до неё',
   'number', '3', false, 'дн', 0, 30, NULL, ARRAY['org'], true, 85);

-- Плановые статьи, которые нельзя вывести из данных: налоги, аренда, зарплата штата.
CREATE TABLE public.planned_cash_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_date date NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX planned_cash_items_idx ON public.planned_cash_items (org_id, item_date);
ALTER TABLE public.planned_cash_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.planned_cash_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.planned_cash_items TO authenticated;
GRANT ALL ON public.planned_cash_items TO service_role;
CREATE POLICY "Planned items: view" ON public.planned_cash_items FOR SELECT TO authenticated USING (private.permission_scope(auth.uid(), org_id, 'cashflow', 'view') = 'all');
CREATE POLICY "Planned items: add" ON public.planned_cash_items FOR INSERT TO authenticated WITH CHECK (private.permission_scope(auth.uid(), org_id, 'cashflow', 'create') = 'all');
CREATE POLICY "Planned items: edit" ON public.planned_cash_items FOR UPDATE TO authenticated
  USING (private.permission_scope(auth.uid(), org_id, 'cashflow', 'update') = 'all') WITH CHECK (private.permission_scope(auth.uid(), org_id, 'cashflow', 'update') = 'all');
CREATE POLICY "Planned items: delete" ON public.planned_cash_items FOR DELETE TO authenticated USING (private.permission_scope(auth.uid(), org_id, 'cashflow', 'delete') = 'all');

-- Дата ближайшей выплаты не раньше _day: день недели из настройки.
CREATE OR REPLACE FUNCTION private.next_payout_date(_day date, _weekday integer)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$ SELECT _day + ((_weekday - extract(isodow FROM _day)::integer + 7) % 7) $$;

CREATE OR REPLACE FUNCTION private.billing_days(_period text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$ SELECT CASE _period WHEN 'week' THEN 7 WHEN 'two_weeks' THEN 14 ELSE 30 END $$;

-- Календарь по дням. Остаток на начало — деньги на всех счетах на конец предыдущего дня.
CREATE OR REPLACE FUNCTION public.payment_calendar(_org_id uuid, _from date DEFAULT current_date, _days integer DEFAULT 28)
RETURNS TABLE (day date, balance_open numeric, in_invoices numeric, in_plan numeric, in_manual numeric, out_registries numeric,
               out_accrued numeric, out_plan numeric, out_manual numeric, balance_close numeric, gap boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  wd integer := coalesce(public.get_setting_numeric(_org_id, 'payout.weekday'), 5)::integer;
  lag integer := coalesce(public.get_setting_numeric(_org_id, 'payout.lag_days'), 3)::integer;
  last_day date := _from + _days - 1;
  start_bal numeric;
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'cashflow', 'view') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _days < 1 OR _days > 120 THEN RAISE EXCEPTION 'Горизонт — от 1 до 120 дней' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(sum(balance), 0) INTO start_bal FROM public.cash_balances(_org_id, _from - 1);

  RETURN QUERY
  WITH days AS (SELECT d::date AS d FROM generate_series(_from, last_day, interval '1 day') d),
  -- Поступления по выставленным счетам: просроченные ждём с первого дня календаря
  inv AS (
    SELECT greatest(i.due_date, _from) AS d, sum(private.invoice_outstanding(i.id)) AS amt
    FROM public.client_documents i
    WHERE i.org_id = _org_id AND i.kind = 'invoice' AND i.status IN ('issued', 'signed', 'paid_partial') AND private.invoice_outstanding(i.id) > 0
    GROUP BY 1
  ),
  -- Начисления заказчику, по которым счёт ещё не выставлен
  acc_in AS (
    SELECT greatest(x.shift_date + private.billing_days(k.billing_period) + coalesce(k.payment_delay_days, 0), _from) AS d, sum(x.amount_client) AS amt
    FROM public.accruals x
    LEFT JOIN LATERAL (SELECT c.billing_period, c.payment_delay_days FROM public.contracts c WHERE c.client_id = x.client_id AND c.status = 'active' ORDER BY c.signed_on DESC LIMIT 1) k ON true
    WHERE x.org_id = _org_id AND x.client_document_id IS NULL AND x.status <> 'draft' AND x.amount_client > 0
    GROUP BY 1
  ),
  -- Смены, по которым ещё нет начисления: ожидаемая выручка и затраты на исполнителей
  plan AS (
    SELECT s.shift_date, a.worker_id,
           round(r.client_rate * private.shift_weighted_hours(s.id, false), 2) AS client_amt,
           round(r.worker_rate * private.shift_weighted_hours(s.id, true), 2) AS worker_amt,
           k.billing_period, k.payment_delay_days
    FROM public.assignments a
    JOIN public.shifts s ON s.id = a.shift_id AND s.status <> 'cancelled'
    JOIN public.shift_rates r ON r.shift_id = s.id AND r.unit = 'hour'
    LEFT JOIN LATERAL (SELECT c.billing_period, c.payment_delay_days FROM public.contracts c WHERE c.client_id = s.client_id AND c.status = 'active' ORDER BY c.signed_on DESC LIMIT 1) k ON true
    WHERE a.org_id = _org_id AND NOT a.is_reserve AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked') AND s.shift_date >= _from - 14
      AND NOT EXISTS (SELECT 1 FROM public.accruals m WHERE m.assignment_id = a.id AND m.kind = 'main')
  ),
  plan_in AS (SELECT greatest(shift_date + private.billing_days(billing_period) + coalesce(payment_delay_days, 0), _from) AS d, sum(client_amt) AS amt FROM plan GROUP BY 1),
  plan_out AS (SELECT private.next_payout_date(greatest(shift_date + lag, _from), wd) AS d, sum(worker_amt) AS amt FROM plan GROUP BY 1),
  -- Реестры в работе уходят в ближайшие дни: берём первый день календаря
  regs AS (
    SELECT _from AS d, sum(l.amount_to_pay) AS amt FROM public.payout_lines l JOIN public.payout_registries r ON r.id = l.registry_id
    WHERE r.org_id = _org_id AND r.status IN ('composed', 'confirmed', 'sent', 'paid_partial') AND l.status = 'pending'
  ),
  -- Начисленное к выплате и не попавшее в реестр: уходит в даты выплат по графику
  payouts AS (
    SELECT p.d FROM days p WHERE extract(isodow FROM p.d)::integer = wd
  ),
  due AS (
    SELECT x.worker_id, x.shift_date, x.amount_worker, private.next_payout_date(greatest(x.shift_date + lag, _from), wd) AS d
    FROM public.accruals x
    WHERE x.org_id = _org_id AND x.payout_line_id IS NULL AND x.status IN ('approved', 'in_act') AND x.amount_worker <> 0
  ),
  acc_out AS (SELECT d, sum(greatest(w, 0)) AS amt FROM (SELECT d, worker_id, sum(amount_worker) AS w FROM due GROUP BY d, worker_id) z GROUP BY d),
  adv AS (
    SELECT private.next_payout_date(_from, wd) AS d, sum(amount) AS amt FROM public.worker_advances WHERE org_id = _org_id AND status = 'approved'
  ),
  manual AS (
    SELECT item_date AS d, sum(amount) FILTER (WHERE direction = 'in') AS amt_in, sum(amount) FILTER (WHERE direction = 'out') AS amt_out
    FROM public.planned_cash_items WHERE org_id = _org_id GROUP BY item_date
  ),
  rows_ AS (
    SELECT days.d,
           coalesce((SELECT amt FROM inv WHERE inv.d = days.d), 0) AS in_inv,
           coalesce((SELECT sum(amt) FROM acc_in WHERE acc_in.d = days.d), 0) + coalesce((SELECT sum(amt) FROM plan_in WHERE plan_in.d = days.d), 0) AS in_pl,
           coalesce((SELECT amt_in FROM manual WHERE manual.d = days.d), 0) AS in_man,
           coalesce((SELECT amt FROM regs WHERE regs.d = days.d), 0) AS out_reg,
           coalesce((SELECT sum(amt) FROM acc_out WHERE acc_out.d = days.d), 0) + coalesce((SELECT amt FROM adv WHERE adv.d = days.d), 0) AS out_acc,
           coalesce((SELECT sum(amt) FROM plan_out WHERE plan_out.d = days.d), 0) AS out_pl,
           coalesce((SELECT amt_out FROM manual WHERE manual.d = days.d), 0) AS out_man
    FROM days
  ),
  run AS (
    SELECT r.*, start_bal + sum(in_inv + in_pl + in_man - out_reg - out_acc - out_pl - out_man) OVER (ORDER BY d) AS closing FROM rows_ r
  )
  SELECT run.d, run.closing - (in_inv + in_pl + in_man - out_reg - out_acc - out_pl - out_man), in_inv, in_pl, in_man, out_reg, out_acc, out_pl, out_man, run.closing, run.closing < 0
  FROM run ORDER BY run.d;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.payment_calendar(uuid, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_calendar(uuid, date, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.next_payout_date(date, integer), private.billing_days(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.next_payout_date(date, integer), private.billing_days(text) TO service_role;
