-- Пересчёт агрегатов аналитики выполняется по одному: замок на время транзакции.
CREATE OR REPLACE FUNCTION private.refresh_analytics(_org_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  -- Два одновременных открытия дашборда не должны пересчитывать одни и те же дни одновременно (иначе повтор ключа): очередь по замку.
  PERFORM pg_advisory_xact_lock(hashtext('analytics_refresh'));
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
REVOKE EXECUTE ON FUNCTION private.refresh_analytics(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.refresh_analytics(uuid[]) TO service_role;
