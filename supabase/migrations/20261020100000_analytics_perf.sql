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
