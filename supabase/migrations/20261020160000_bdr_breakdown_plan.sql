-- План выручки по заказчикам в разрезе «заказчик» отчёта БДР (ТЗ, Ф-7).
DROP FUNCTION public.bdr_breakdown(uuid[], date, date, text);
CREATE OR REPLACE FUNCTION public.bdr_breakdown(_org_ids uuid[], _from date, _to date, _dimension text)
RETURNS TABLE (key text, name text, revenue numeric, worker_costs numeric, margin numeric, margin_pct numeric, revenue_plan numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  allowed uuid[];
BEGIN
  IF _dimension NOT IN ('client', 'site', 'manager', 'org') THEN RAISE EXCEPTION 'Неизвестный разрез' USING ERRCODE = '22023'; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  SELECT array_agg(o) INTO allowed FROM unnest(_org_ids) o WHERE private.permission_scope(auth.uid(), o, 'cashflow', 'view') = 'all';
  IF allowed IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT g.k, coalesce(g.n, 'Не указан'), g.rev, g.wc, g.rev - g.wc, CASE WHEN g.rev > 0 THEN round((g.rev - g.wc) / g.rev * 100, 1) END,
         -- План выручки ведётся по заказчикам: в этом разрезе показываем его (месяцы периода), в остальных — пусто
         CASE WHEN _dimension = 'client' THEN (SELECT sum(p.amount) FROM public.bdr_plans p WHERE p.org_id = ANY (allowed) AND p.article = 'revenue' AND p.client_id::text = g.k
                                               AND p.month BETWEEN date_trunc('month', _from)::date AND _to) END
  FROM (
    SELECT CASE _dimension WHEN 'client' THEN a.client_id::text WHEN 'site' THEN a.site_id::text WHEN 'manager' THEN coalesce(c.sales_manager_id::text, '-') ELSE a.org_id::text END AS k,
           CASE _dimension WHEN 'client' THEN c.name WHEN 'site' THEN s.name WHEN 'manager' THEN sp.full_name ELSE o.name END AS n,
           sum(a.amount_client) AS rev, sum(a.amount_worker) AS wc
    FROM public.accruals a
    JOIN public.clients c ON c.id = a.client_id
    JOIN public.sites s ON s.id = a.site_id
    JOIN public.organizations o ON o.id = a.org_id
    LEFT JOIN public.staff_profiles sp ON sp.user_id = c.sales_manager_id
    WHERE a.org_id = ANY (allowed) AND a.status <> 'draft' AND private.accrual_date(a.kind, a.shift_date, a.period_month) BETWEEN _from AND _to
    GROUP BY 1, 2
  ) g
  ORDER BY g.rev DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bdr_breakdown(uuid[], date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bdr_breakdown(uuid[], date, date, text) TO authenticated, service_role;
