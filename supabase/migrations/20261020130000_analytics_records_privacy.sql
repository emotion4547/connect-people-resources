-- Записи метрик с именами людей (активная база, удержание, найм) не показываются ролям, у которых нет доступа ко всем исполнителям или кандидатам.
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
  -- Записи с именами людей показываются только тем, кто и так видит всех исполнителей или всех кандидатов организации.
  IF _metric IN ('active_base', 'retention_30', 'retention_60', 'retention_90') THEN
    SELECT coalesce(array_agg(o), ARRAY[]::uuid[]) INTO orgs FROM unnest(orgs) o WHERE private.permission_scope(uid, o, 'workers', 'view') = 'all';
  ELSIF _metric IN ('hire_conversion', 'time_to_admit_days') THEN
    SELECT coalesce(array_agg(o), ARRAY[]::uuid[]) INTO orgs FROM unnest(orgs) o WHERE private.permission_scope(uid, o, 'candidates', 'view') = 'all';
  END IF;
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
REVOKE EXECUTE ON FUNCTION public.analytics_records(uuid[], text, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_records(uuid[], text, date, date, uuid) TO authenticated, service_role;

-- Календарь вахт называет людей поимённо: нужен доступ и к заказам, и к назначениям.
CREATE OR REPLACE FUNCTION public.rotation_calendar(_org_id uuid, _from date, _days integer DEFAULT 28)
RETURNS TABLE (order_id uuid, site_name text, client_name text, housing_address text, worker_id uuid, worker_name text, arrival_date date, departure_date date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'orders', 'view') = 'none' OR private.permission_scope(auth.uid(), _org_id, 'assignments', 'view') = 'none' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _days < 1 OR _days > 120 THEN RAISE EXCEPTION 'Горизонт — от 1 до 120 дней' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
  SELECT m.order_id, st.name, c.name, r.housing_address, m.worker_id, w.full_name, m.arrival_date, m.departure_date
  FROM public.rotation_members m
  JOIN public.order_rotations r ON r.order_id = m.order_id
  JOIN public.orders o ON o.id = m.order_id AND o.status <> 'cancelled'
  JOIN public.sites st ON st.id = o.site_id JOIN public.clients c ON c.id = o.client_id
  JOIN public.workers w ON w.user_id = m.worker_id AND w.org_id = m.org_id
  WHERE m.org_id = _org_id AND m.arrival_date <= _from + _days - 1 AND m.departure_date >= _from AND private.order_in_scope(m.order_id, 'view')
  ORDER BY c.name, st.name, w.full_name;
END;
$$;
