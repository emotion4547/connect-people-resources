-- Производительность аналитики: пересчёт агрегатов одним проходом по всем помеченным дням (раньше — день за днём, на год данных это минуты),
-- а записи метрики выбираются с ограничением до соединений.
CREATE OR REPLACE FUNCTION private.refresh_analytics(_org_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _an_todo (org_id uuid NOT NULL, day date NOT NULL, PRIMARY KEY (org_id, day)) ON COMMIT DROP;
  TRUNCATE _an_todo;
  INSERT INTO _an_todo
    SELECT org_id, day FROM public.analytics_dirty WHERE org_id = ANY (_org_ids)
    UNION
    SELECT org_id, day FROM public.analytics_daily WHERE org_id = ANY (_org_ids) AND day <= current_date AND computed_at < (day + 1)::timestamptz;
  IF NOT EXISTS (SELECT 1 FROM _an_todo) THEN RETURN; END IF;
  DELETE FROM public.analytics_daily d USING _an_todo t WHERE d.org_id = t.org_id AND d.day = t.day;
  INSERT INTO public.analytics_daily (org_id, day, client_id, site_id, shifts, needed, confirmed, started_needed, on_site, started_assigned, no_shows, hours, revenue, worker_costs, margin, computed_at)
  SELECT k.org_id, k.day, k.client_id, k.site_id, coalesce(o.shifts, 0), coalesce(o.needed, 0), coalesce(o.confirmed, 0), coalesce(o.started_needed, 0), coalesce(o.on_site, 0),
         coalesce(o.started_assigned, 0), coalesce(o.no_shows, 0), coalesce(o.hours, 0), coalesce(f.revenue, 0), coalesce(f.worker_costs, 0), coalesce(f.margin, 0), now()
  FROM (
    SELECT s.org_id, s.shift_date AS day, s.client_id, s.site_id FROM public.shifts s JOIN _an_todo t ON t.org_id = s.org_id AND t.day = s.shift_date WHERE s.status <> 'cancelled'
    UNION
    SELECT a.org_id, private.accrual_date(a.kind, a.shift_date, a.period_month), a.client_id, a.site_id FROM public.accruals a
    JOIN _an_todo t ON t.org_id = a.org_id AND t.day = private.accrual_date(a.kind, a.shift_date, a.period_month) WHERE a.status <> 'draft'
  ) k
  LEFT JOIN (
    SELECT s.org_id, s.shift_date AS day, s.client_id, s.site_id, count(*)::integer AS shifts, sum(s.headcount)::integer AS needed, sum(least(s.headcount, c.confirmed))::integer AS confirmed,
           (sum(s.headcount) FILTER (WHERE s.start_at <= now()))::integer AS started_needed,
           (sum(least(s.headcount, c.on_site)) FILTER (WHERE s.start_at <= now()))::integer AS on_site,
           (sum(c.assigned) FILTER (WHERE s.start_at <= now()))::integer AS started_assigned,
           (sum(c.no_show) FILTER (WHERE s.start_at <= now()))::integer AS no_shows, sum(c.hours) AS hours
    FROM public.shifts s JOIN _an_todo t ON t.org_id = s.org_id AND t.day = s.shift_date
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE a.status IN ('confirmed', 'on_site', 'worked')) AS confirmed,
             count(*) FILTER (WHERE a.status IN ('on_site', 'worked')) AS on_site,
             count(*) FILTER (WHERE a.status IN ('assigned', 'confirmed', 'on_site', 'worked', 'no_show')) AS assigned,
             count(*) FILTER (WHERE a.status = 'no_show') AS no_show,
             coalesce(sum(coalesce(a.approved_hours, a.actual_hours)) FILTER (WHERE a.status = 'worked'), 0) AS hours
      FROM public.assignments a WHERE a.shift_id = s.id AND NOT a.is_reserve
    ) c
    WHERE s.status <> 'cancelled' GROUP BY 1, 2, 3, 4
  ) o ON o.org_id = k.org_id AND o.day = k.day AND o.client_id = k.client_id AND o.site_id = k.site_id
  LEFT JOIN (
    SELECT a.org_id, private.accrual_date(a.kind, a.shift_date, a.period_month) AS day, a.client_id, a.site_id,
           sum(a.amount_client) AS revenue, sum(a.amount_worker) AS worker_costs, sum(a.margin) AS margin
    FROM public.accruals a JOIN _an_todo t ON t.org_id = a.org_id AND t.day = private.accrual_date(a.kind, a.shift_date, a.period_month)
    WHERE a.status <> 'draft' GROUP BY 1, 2, 3, 4
  ) f ON f.org_id = k.org_id AND f.day = k.day AND f.client_id = k.client_id AND f.site_id = k.site_id;
  DELETE FROM public.analytics_dirty d USING _an_todo t WHERE d.org_id = t.org_id AND d.day = t.day;
END;
$$;

CREATE INDEX IF NOT EXISTS assignments_shift_idx ON public.assignments (shift_id);
CREATE INDEX IF NOT EXISTS shifts_org_date_idx ON public.shifts (org_id, shift_date);

CREATE OR REPLACE FUNCTION public.analytics_records(_org_ids uuid[], _metric text, _from date, _to date, _client_id uuid DEFAULT NULL)
RETURNS TABLE (record_id uuid, kind text, label text, detail text, record_date date, amount numeric, link text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  uid uuid := auth.uid();
  grp text := CASE
    WHEN _metric IN ('staffing', 'attendance', 'no_show', 'order_close_hours', 'active_base', 'hours') THEN 'ops'
    WHEN _metric IN ('revenue', 'worker_costs', 'margin_amount', 'margin_pct', 'overdue_receivables', 'receivables_total') THEN 'fin'
    WHEN _metric IN ('retention_30', 'retention_60', 'retention_90', 'hire_conversion', 'time_to_admit_days') THEN 'hire' END;
  orgs uuid[];
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF grp IS NULL THEN RAISE EXCEPTION 'Неизвестная метрика' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(array_agg(o), ARRAY[]::uuid[]) INTO orgs FROM unnest(_org_ids) o WHERE grp = ANY (private.analytics_groups(o));
  IF cardinality(orgs) = 0 THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;

  IF _metric IN ('staffing', 'attendance', 'no_show', 'hours') THEN
    RETURN QUERY
    SELECT s.id, 'shift'::text, cl.name || ' · ' || st.name,
           CASE _metric
             WHEN 'staffing' THEN 'нужно ' || s.headcount || ', подтвердили ' || least(s.headcount, c.confirmed)
             WHEN 'attendance' THEN 'нужно ' || s.headcount || ', на месте ' || least(s.headcount, c.on_site)
             WHEN 'no_show' THEN 'назначено ' || c.assigned || ', не вышли ' || c.no_show
             ELSE 'часов ' || c.hours END,
           s.shift_date,
           CASE _metric WHEN 'staffing' THEN least(s.headcount, c.confirmed) WHEN 'attendance' THEN least(s.headcount, c.on_site)
                        WHEN 'no_show' THEN c.no_show ELSE c.hours END::numeric,
           '/orders/' || s.order_id
    FROM (SELECT * FROM public.shifts s0
          WHERE s0.org_id = ANY (orgs) AND s0.shift_date BETWEEN _from AND _to AND s0.status <> 'cancelled' AND (_client_id IS NULL OR s0.client_id = _client_id)
            AND private.analytics_client_ok(s0.org_id, s0.client_id, uid) AND (_metric = 'staffing' OR s0.start_at <= now())
          ORDER BY s0.shift_date DESC LIMIT 500) s
    JOIN public.clients cl ON cl.id = s.client_id JOIN public.sites st ON st.id = s.site_id
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE a.status IN ('confirmed', 'on_site', 'worked')) AS confirmed,
             count(*) FILTER (WHERE a.status IN ('on_site', 'worked')) AS on_site,
             count(*) FILTER (WHERE a.status IN ('assigned', 'confirmed', 'on_site', 'worked', 'no_show')) AS assigned,
             count(*) FILTER (WHERE a.status = 'no_show') AS no_show,
             coalesce(sum(coalesce(a.approved_hours, a.actual_hours)) FILTER (WHERE a.status = 'worked'), 0) AS hours
      FROM public.assignments a WHERE a.shift_id = s.id AND NOT a.is_reserve
    ) c
    WHERE s.org_id = ANY (orgs) AND s.shift_date BETWEEN _from AND _to AND s.status <> 'cancelled' AND (_client_id IS NULL OR s.client_id = _client_id)
      AND private.analytics_client_ok(s.org_id, s.client_id, uid)
      AND (_metric IN ('staffing') OR s.start_at <= now())
    ORDER BY s.shift_date DESC, cl.name LIMIT 500;

  ELSIF _metric IN ('revenue', 'worker_costs', 'margin_amount', 'margin_pct') THEN
    RETURN QUERY
    SELECT a.id, 'accrual'::text, cl.name || ' · ' || st.name, w.full_name || ', ' || a.quantity || ' ч',
           private.accrual_date(a.kind, a.shift_date, a.period_month),
           CASE WHEN _metric = 'revenue' THEN a.amount_client WHEN _metric = 'worker_costs' THEN a.amount_worker ELSE a.margin END,
           '/orders/' || s2.order_id
    FROM (SELECT * FROM public.accruals a0
          WHERE a0.org_id = ANY (orgs) AND a0.status <> 'draft' AND private.accrual_date(a0.kind, a0.shift_date, a0.period_month) BETWEEN _from AND _to
            AND (_client_id IS NULL OR a0.client_id = _client_id) AND private.analytics_client_ok(a0.org_id, a0.client_id, uid)
          ORDER BY private.accrual_date(a0.kind, a0.shift_date, a0.period_month) DESC LIMIT 500) a
    JOIN public.clients cl ON cl.id = a.client_id JOIN public.sites st ON st.id = a.site_id
    JOIN public.workers w ON w.user_id = a.worker_id AND w.org_id = a.org_id
    LEFT JOIN public.assignments asg ON asg.id = a.assignment_id LEFT JOIN public.shifts s2 ON s2.id = asg.shift_id
    WHERE a.org_id = ANY (orgs) AND a.status <> 'draft' AND private.accrual_date(a.kind, a.shift_date, a.period_month) BETWEEN _from AND _to
      AND (_client_id IS NULL OR a.client_id = _client_id) AND private.analytics_client_ok(a.org_id, a.client_id, uid)
    ORDER BY 5 DESC, 3 LIMIT 500;

  ELSIF _metric IN ('overdue_receivables', 'receivables_total') THEN
    RETURN QUERY
    SELECT i.id, 'invoice'::text, cl.name || ' · счёт ' || coalesce(i.number, ''), 'срок оплаты ' || to_char(i.due_date, 'DD.MM.YYYY'), i.due_date,
           private.invoice_outstanding(i.id), '/documents/' || i.id
    FROM public.client_documents i JOIN public.clients cl ON cl.id = i.client_id
    WHERE i.org_id = ANY (orgs) AND i.kind = 'invoice' AND i.status IN ('issued', 'signed', 'paid_partial') AND private.invoice_outstanding(i.id) > 0
      AND (_metric = 'receivables_total' OR i.due_date < current_date) AND (_client_id IS NULL OR i.client_id = _client_id)
      AND private.analytics_client_ok(i.org_id, i.client_id, uid)
    ORDER BY i.due_date LIMIT 500;

  ELSIF _metric = 'active_base' THEN
    RETURN QUERY
    SELECT w.user_id, 'worker'::text, w.full_name, 'смен за 30 дней: ' || count(*), max(a.shift_start)::date, count(*)::numeric, '/workers/' || w.user_id
    FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id JOIN public.workers w ON w.user_id = a.worker_id AND w.org_id = a.org_id
    WHERE a.org_id = ANY (orgs) AND a.status = 'worked' AND a.shift_start::date BETWEEN _to - 29 AND _to AND (_client_id IS NULL OR s.client_id = _client_id)
      AND private.analytics_client_ok(s.org_id, s.client_id, uid)
    GROUP BY w.user_id, w.full_name ORDER BY 7, 3 LIMIT 500;

  ELSIF _metric = 'order_close_hours' THEN
    RETURN QUERY
    SELECT o.id, 'order'::text, cl.name || ' · заказ', 'принят ' || to_char(o.accepted_at, 'DD.MM.YYYY HH24:MI'), o.accepted_at::date,
           round(extract(epoch FROM (t.full_at - o.accepted_at))::numeric / 3600, 1), '/orders/' || o.id
    FROM public.orders o JOIN public.clients cl ON cl.id = o.client_id
    CROSS JOIN LATERAL (
      SELECT (SELECT q.created_at FROM (
               SELECT a.created_at, row_number() OVER (ORDER BY a.created_at) AS rn FROM public.assignments a
               WHERE a.shift_id = fs.id AND NOT a.is_reserve AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked')) q WHERE q.rn = fs.headcount) AS full_at
      FROM (SELECT s.id, s.headcount FROM public.shifts s WHERE s.order_id = o.id AND s.status <> 'cancelled' ORDER BY s.shift_date LIMIT 1) fs
    ) t
    WHERE o.org_id = ANY (orgs) AND o.accepted_at >= _from AND o.accepted_at < _to + 1 AND t.full_at IS NOT NULL AND (_client_id IS NULL OR o.client_id = _client_id)
      AND private.analytics_client_ok(o.org_id, o.client_id, uid)
    ORDER BY 6 DESC LIMIT 500;

  ELSIF _metric LIKE 'retention_%' THEN
    RETURN QUERY
    SELECT w.user_id, 'worker'::text, w.full_name, 'допущен ' || to_char(w.admitted_at, 'DD.MM.YYYY'), w.admitted_at::date,
           (EXISTS (SELECT 1 FROM public.assignments a WHERE a.worker_id = w.user_id AND a.org_id = w.org_id AND a.status = 'worked'
                    AND a.shift_start >= w.admitted_at + make_interval(days => split_part(_metric, '_', 2)::integer)))::integer::numeric,
           '/workers/' || w.user_id
    FROM public.workers w
    WHERE w.org_id = ANY (orgs) AND w.admitted_at::date BETWEEN _from AND _to AND w.admitted_at + make_interval(days => split_part(_metric, '_', 2)::integer) <= now()
    ORDER BY w.admitted_at LIMIT 500;

  ELSE
    RETURN QUERY
    SELECT c.id, 'candidate'::text, c.full_name, 'этап: ' || c.stage, c.created_at::date,
           CASE WHEN _metric = 'hire_conversion' THEN (c.stage = 'admitted')::integer::numeric
                ELSE round(extract(epoch FROM (w.admitted_at - c.created_at))::numeric / 86400, 1) END,
           '/candidates/' || c.id
    FROM public.candidates c LEFT JOIN public.workers w ON w.user_id = c.admitted_worker_id AND w.org_id = c.org_id
    WHERE c.org_id = ANY (orgs) AND c.created_at::date BETWEEN _from AND _to
      AND (_metric = 'hire_conversion' OR (c.stage = 'admitted' AND w.admitted_at IS NOT NULL))
    ORDER BY c.created_at DESC LIMIT 500;
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.refresh_analytics(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.refresh_analytics(uuid[]) TO service_role;

-- Платёжный календарь: договор заказчика подбирается один раз, а не для каждого начисления (на годе данных 6,9 с → доли секунды).
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
  -- Действующий договор заказчика берём один раз, а не на каждое начисление
  ctr AS MATERIALIZED (SELECT DISTINCT ON (c.client_id) c.client_id, c.billing_period, c.payment_delay_days FROM public.contracts c WHERE c.org_id = _org_id AND c.status = 'active' ORDER BY c.client_id, c.signed_on DESC),
  -- Поступления по выставленным счетам: просроченные ждём с первого дня календаря
  inv AS MATERIALIZED (
    SELECT greatest(i.due_date, _from) AS d, sum(private.invoice_outstanding(i.id)) AS amt
    FROM public.client_documents i
    WHERE i.org_id = _org_id AND i.kind = 'invoice' AND i.status IN ('issued', 'signed', 'paid_partial') AND private.invoice_outstanding(i.id) > 0
    GROUP BY 1
  ),
  -- Начисления заказчику, по которым счёт ещё не выставлен
  acc_in AS MATERIALIZED (
    SELECT greatest(g.shift_date + private.billing_days(k.billing_period) + coalesce(k.payment_delay_days, 0), _from) AS d, sum(g.amt) AS amt
    FROM (SELECT x.client_id, x.shift_date, sum(x.amount_client) AS amt FROM public.accruals x
          WHERE x.org_id = _org_id AND x.client_document_id IS NULL AND x.status <> 'draft' AND x.amount_client > 0 GROUP BY 1, 2) g
    LEFT JOIN ctr k ON k.client_id = g.client_id
    GROUP BY 1
  ),
  -- Смены, по которым ещё нет начисления: ожидаемая выручка и затраты на исполнителей
  plan AS MATERIALIZED (
    SELECT s.shift_date, a.worker_id,
           round(r.client_rate * private.shift_weighted_hours(s.id, false), 2) AS client_amt,
           round(r.worker_rate * private.shift_weighted_hours(s.id, true), 2) AS worker_amt,
           k.billing_period, k.payment_delay_days
    FROM public.assignments a
    JOIN public.shifts s ON s.id = a.shift_id AND s.status <> 'cancelled'
    JOIN public.shift_rates r ON r.shift_id = s.id AND r.unit = 'hour'
    LEFT JOIN ctr k ON k.client_id = s.client_id
    WHERE a.org_id = _org_id AND NOT a.is_reserve AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked') AND s.shift_date >= _from - 14
      AND NOT EXISTS (SELECT 1 FROM public.accruals m WHERE m.assignment_id = a.id AND m.kind = 'main')
  ),
  plan_in AS MATERIALIZED (SELECT greatest(shift_date + private.billing_days(billing_period) + coalesce(payment_delay_days, 0), _from) AS d, sum(client_amt) AS amt FROM plan GROUP BY 1),
  plan_out AS MATERIALIZED (SELECT private.next_payout_date(greatest(shift_date + lag, _from), wd) AS d, sum(worker_amt) AS amt FROM plan GROUP BY 1),
  -- Реестры в работе уходят в ближайшие дни: берём первый день календаря
  regs AS MATERIALIZED (
    SELECT _from AS d, sum(l.amount_to_pay) AS amt FROM public.payout_lines l JOIN public.payout_registries r ON r.id = l.registry_id
    WHERE r.org_id = _org_id AND r.status IN ('composed', 'confirmed', 'sent', 'paid_partial') AND l.status = 'pending'
  ),
  -- Начисленное к выплате и не попавшее в реестр: уходит в даты выплат по графику
  payouts AS (
    SELECT p.d FROM days p WHERE extract(isodow FROM p.d)::integer = wd
  ),
  due AS MATERIALIZED (
    SELECT x.worker_id, x.shift_date, sum(x.amount_worker) AS amount_worker, private.next_payout_date(greatest(x.shift_date + lag, _from), wd) AS d
    FROM public.accruals x
    WHERE x.org_id = _org_id AND x.payout_line_id IS NULL AND x.status IN ('approved', 'in_act') AND x.amount_worker <> 0
    GROUP BY x.worker_id, x.shift_date
  ),
  acc_out AS MATERIALIZED (SELECT d, sum(greatest(w, 0)) AS amt FROM (SELECT d, worker_id, sum(amount_worker) AS w FROM due GROUP BY d, worker_id) z GROUP BY d),
  adv AS MATERIALIZED (
    SELECT private.next_payout_date(_from, wd) AS d, sum(amount) AS amt FROM public.worker_advances WHERE org_id = _org_id AND status = 'approved'
  ),
  manual AS MATERIALIZED (
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
