-- Этап 3, шаг 26: дашборды отделов.
-- ТЗ: раздел 17 (Ан-1, Ан-4).
--
-- Показатели дашбордов берутся из тех же функций, что и страница «Аналитика», поэтому число у руководителя и в отделе одно и то же.
-- Здесь — срезы и счётчики, которых нет среди метрик: заказчики с падающей маржой, укомплектованность по объектам, кандидаты по
-- источникам, очереди бухгалтерии и ведения объектов, план/факт выручки и маржи, кабинет заказчика.

CREATE OR REPLACE FUNCTION private.analytics_unrestricted(_org_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT coalesce(bool_or(ur.role::text NOT IN ('sales', 'site_manager')), false) FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.org_id = _org_id
$$;

-- Организации, в которых пользователю открыта группа показателей.
CREATE OR REPLACE FUNCTION private.analytics_orgs(_org_ids uuid[], _group text)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT coalesce(array_agg(o), ARRAY[]::uuid[]) FROM unnest(_org_ids) o WHERE _group = ANY (private.analytics_groups(o))
$$;

-- ============================================================
-- 1. Заказчики: выручка, маржа и её динамика
-- ============================================================
CREATE OR REPLACE FUNCTION public.analytics_by_client(_org_ids uuid[], _from date, _to date)
RETURNS TABLE (client_id uuid, client_name text, revenue numeric, margin numeric, margin_pct numeric, prev_margin_pct numeric, margin_falling boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  fin uuid[] := private.analytics_orgs(_org_ids, 'fin');
  len integer := _to - _from + 1;
  prev_to date := _from - 1;
BEGIN
  IF auth.uid() IS NULL OR cardinality(fin) = 0 THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  PERFORM private.refresh_analytics(fin);
  RETURN QUERY
  WITH cur AS (
    SELECT d.client_id, sum(d.revenue) AS rev, sum(d.margin) AS mar FROM public.analytics_daily d
    WHERE d.org_id = ANY (fin) AND d.day BETWEEN _from AND _to AND private.analytics_client_ok(d.org_id, d.client_id, auth.uid()) GROUP BY d.client_id
  ), prv AS (
    SELECT d.client_id, sum(d.revenue) AS rev, sum(d.margin) AS mar FROM public.analytics_daily d
    WHERE d.org_id = ANY (fin) AND d.day BETWEEN prev_to - len + 1 AND prev_to AND private.analytics_client_ok(d.org_id, d.client_id, auth.uid()) GROUP BY d.client_id
  )
  SELECT c.id, c.name, cur.rev, cur.mar,
         CASE WHEN cur.rev > 0 THEN round(cur.mar / cur.rev * 100, 1) END,
         CASE WHEN prv.rev > 0 THEN round(prv.mar / prv.rev * 100, 1) END,
         coalesce(cur.rev > 0 AND prv.rev > 0 AND cur.mar / cur.rev < prv.mar / prv.rev - 0.02, false)
  FROM cur JOIN public.clients c ON c.id = cur.client_id LEFT JOIN prv ON prv.client_id = cur.client_id
  ORDER BY cur.rev DESC;
END;
$$;

-- ============================================================
-- 2. Объекты: укомплектованность и выход
-- ============================================================
CREATE OR REPLACE FUNCTION public.analytics_by_site(_org_ids uuid[], _from date, _to date)
RETURNS TABLE (site_id uuid, site_name text, client_name text, needed bigint, confirmed bigint, started_needed bigint, on_site bigint, started_assigned bigint, no_shows bigint,
               today_needed bigint, today_confirmed bigint, week_needed bigint, week_confirmed bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  ops uuid[] := private.analytics_orgs(_org_ids, 'ops');
BEGIN
  IF auth.uid() IS NULL OR cardinality(ops) = 0 THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  PERFORM private.refresh_analytics(ops);
  RETURN QUERY
  SELECT s.id, s.name, c.name,
         coalesce(sum(d.needed) FILTER (WHERE d.day BETWEEN _from AND _to), 0), coalesce(sum(d.confirmed) FILTER (WHERE d.day BETWEEN _from AND _to), 0),
         coalesce(sum(d.started_needed) FILTER (WHERE d.day BETWEEN _from AND _to), 0), coalesce(sum(d.on_site) FILTER (WHERE d.day BETWEEN _from AND _to), 0),
         coalesce(sum(d.started_assigned) FILTER (WHERE d.day BETWEEN _from AND _to), 0), coalesce(sum(d.no_shows) FILTER (WHERE d.day BETWEEN _from AND _to), 0),
         coalesce(sum(d.needed) FILTER (WHERE d.day = current_date), 0), coalesce(sum(d.confirmed) FILTER (WHERE d.day = current_date), 0),
         coalesce(sum(d.needed) FILTER (WHERE d.day BETWEEN current_date AND current_date + 6), 0), coalesce(sum(d.confirmed) FILTER (WHERE d.day BETWEEN current_date AND current_date + 6), 0)
  FROM public.analytics_daily d JOIN public.sites s ON s.id = d.site_id JOIN public.clients c ON c.id = s.client_id
  WHERE d.org_id = ANY (ops) AND (d.day BETWEEN _from AND _to OR d.day BETWEEN current_date AND current_date + 6) AND private.analytics_client_ok(d.org_id, d.client_id, auth.uid())
  GROUP BY s.id, s.name, c.name
  ORDER BY c.name, s.name;
END;
$$;

-- Не подтвердившие выход на выбранный день.
CREATE OR REPLACE FUNCTION public.analytics_unconfirmed(_org_ids uuid[], _day date DEFAULT current_date + 1)
RETURNS TABLE (assignment_id uuid, worker_id uuid, worker_name text, phone text, site_name text, client_name text, shift_start timestamptz, order_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  ops uuid[] := private.analytics_orgs(_org_ids, 'ops');
BEGIN
  IF auth.uid() IS NULL OR cardinality(ops) = 0 THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT a.id, w.user_id, w.full_name, w.phone, st.name, c.name, a.shift_start, s.order_id
  FROM public.assignments a
  JOIN public.shifts s ON s.id = a.shift_id AND s.status <> 'cancelled'
  JOIN public.workers w ON w.user_id = a.worker_id AND w.org_id = a.org_id
  JOIN public.sites st ON st.id = s.site_id JOIN public.clients c ON c.id = s.client_id
  WHERE a.org_id = ANY (ops) AND a.status = 'assigned' AND NOT a.is_reserve AND s.shift_date = _day
    AND private.analytics_client_ok(s.org_id, s.client_id, auth.uid())
    AND private.permission_scope(auth.uid(), a.org_id, 'workers', 'view') <> 'none'
  ORDER BY a.shift_start, w.full_name;
END;
$$;

-- ============================================================
-- 3. Кандидаты по источникам и этапам
-- ============================================================
CREATE OR REPLACE FUNCTION public.analytics_candidates(_org_ids uuid[], _from date, _to date)
RETURNS TABLE (dimension text, key text, name text, total bigint, admitted bigint, sort_order integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  hire uuid[] := private.analytics_orgs(_org_ids, 'hire');
BEGIN
  IF auth.uid() IS NULL OR cardinality(hire) = 0 THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  -- По источникам: новые кандидаты периода и сколько из них допущено
  SELECT 'source'::text, coalesce(c.source_id::text, '-'), coalesce(dr.name, 'Источник не указан'), count(*), count(*) FILTER (WHERE c.stage = 'admitted'), 0
  FROM public.candidates c LEFT JOIN public.directories dr ON dr.id = c.source_id
  WHERE c.org_id = ANY (hire) AND c.created_at::date BETWEEN _from AND _to
  GROUP BY 2, 3
  UNION ALL
  -- По этапам: все кандидаты в работе сейчас
  SELECT 'stage'::text, c.stage, CASE c.stage WHEN 'new' THEN 'Новые' WHEN 'contacted' THEN 'Связались' WHEN 'interview' THEN 'Собеседование' WHEN 'documents' THEN 'Документы'
           WHEN 'admitted' THEN 'Допущены' WHEN 'no_answer' THEN 'Не дозвонились' WHEN 'reserve' THEN 'Резерв' ELSE 'Отказ' END,
         count(*), count(*) FILTER (WHERE c.stage = 'admitted'),
         CASE c.stage WHEN 'new' THEN 1 WHEN 'contacted' THEN 2 WHEN 'interview' THEN 3 WHEN 'documents' THEN 4 WHEN 'admitted' THEN 5 WHEN 'no_answer' THEN 6 WHEN 'reserve' THEN 7 ELSE 8 END
  FROM public.candidates c WHERE c.org_id = ANY (hire) AND c.created_at::date BETWEEN _from AND _to
  GROUP BY 2, 3, 6
  ORDER BY 1, 6, 4 DESC;
END;
$$;

-- ============================================================
-- 4. Счётчики очередей (клик ведёт в раздел со списком)
-- ============================================================
CREATE OR REPLACE FUNCTION public.analytics_counters(_org_ids uuid[], _from date, _to date)
RETURNS TABLE (key text, name text, unit text, value numeric, link text, grp text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  uid uuid := auth.uid();
  ops uuid[] := private.analytics_orgs(_org_ids, 'ops');
  fin uuid[] := private.analytics_orgs(_org_ids, 'fin');
  hire uuid[] := private.analytics_orgs(_org_ids, 'hire');
  paying uuid[]; cash uuid[];
BEGIN
  IF uid IS NULL OR cardinality(ops) + cardinality(fin) + cardinality(hire) = 0 THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(array_agg(o), ARRAY[]::uuid[]) INTO paying FROM unnest(fin) o WHERE private.permission_scope(uid, o, 'payout_registries', 'view') = 'all';
  SELECT coalesce(array_agg(o), ARRAY[]::uuid[]) INTO cash FROM unnest(fin) o WHERE private.permission_scope(uid, o, 'cashflow', 'view') = 'all';

  IF cardinality(ops) > 0 THEN
    RETURN QUERY SELECT 'timesheets_pending', 'Табели на подтверждении', 'шт.', count(*)::numeric, '/timesheets', 'ops'
      FROM public.timesheets t WHERE t.org_id = ANY (ops) AND t.status = 'pending' AND private.analytics_client_ok(t.org_id, t.client_id, uid);
    RETURN QUERY SELECT 'timesheets_disputed', 'Споры по табелям', 'шт.', count(*)::numeric, '/timesheets', 'ops'
      FROM public.timesheet_disputes x JOIN public.timesheets t ON t.id = x.timesheet_id
      WHERE x.org_id = ANY (ops) AND x.status = 'open' AND private.analytics_client_ok(t.org_id, t.client_id, uid);
    RETURN QUERY SELECT 'unconfirmed_tomorrow', 'Не подтвердили выход на завтра', 'чел.', count(*)::numeric, '/planning', 'ops'
      FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id AND s.status <> 'cancelled'
      WHERE a.org_id = ANY (ops) AND a.status = 'assigned' AND NOT a.is_reserve AND s.shift_date = current_date + 1 AND private.analytics_client_ok(s.org_id, s.client_id, uid);
    RETURN QUERY SELECT 'rating_avg', 'Средняя оценка заказчиков', '★', round(avg(a.client_rating)::numeric, 2), NULL::text, 'ops'
      FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id
      WHERE a.org_id = ANY (ops) AND a.client_rating IS NOT NULL AND s.shift_date BETWEEN _from AND _to AND private.analytics_client_ok(s.org_id, s.client_id, uid);
    RETURN QUERY SELECT 'idle_clients_30', 'Заказчики без заказов 30 дней', 'шт.', count(*)::numeric, '/clients', 'ops'
      FROM public.clients c
      WHERE c.org_id = ANY (ops) AND c.status = 'active' AND private.analytics_client_ok(c.org_id, c.id, uid)
        AND EXISTS (SELECT 1 FROM public.shifts s WHERE s.client_id = c.id AND s.status <> 'cancelled')
        AND NOT EXISTS (SELECT 1 FROM public.shifts s WHERE s.client_id = c.id AND s.status <> 'cancelled' AND s.shift_date > current_date - 30);
  END IF;

  IF cardinality(fin) > 0 THEN
    RETURN QUERY SELECT 'unbilled_accruals', 'Невыставленные начисления', '₽', coalesce(sum(a.amount_client), 0), '/documents', 'fin'
      FROM public.accruals a WHERE a.org_id = ANY (fin) AND a.status <> 'draft' AND a.client_document_id IS NULL AND private.analytics_client_ok(a.org_id, a.client_id, uid);
  END IF;

  IF cardinality(paying) > 0 THEN
    RETURN QUERY SELECT 'to_pay', 'К выплате исполнителям', '₽', coalesce(sum(a.amount_worker), 0), '/payout-registries', 'fin'
      FROM public.accruals a WHERE a.org_id = ANY (paying) AND a.status IN ('approved', 'in_act') AND a.payout_line_id IS NULL AND a.amount_worker > 0;
    RETURN QUERY SELECT 'paid_out', 'Выплачено за период', '₽', coalesce(sum(l.amount_to_pay), 0), '/payout-registries', 'fin'
      FROM public.payout_lines l JOIN public.payout_registries r ON r.id = l.registry_id
      WHERE r.org_id = ANY (paying) AND l.status = 'paid' AND l.paid_at::date BETWEEN _from AND _to;
    RETURN QUERY SELECT 'registry_errors', 'Ошибки выплат', 'шт.', count(*)::numeric, '/payout-registries', 'fin'
      FROM public.payout_lines l JOIN public.payout_registries r ON r.id = l.registry_id WHERE r.org_id = ANY (paying) AND l.status = 'error';
  END IF;

  IF cardinality(cash) > 0 THEN
    RETURN QUERY SELECT 'unsorted_cash', 'Неразнесённые операции ДДС', 'шт.', count(*)::numeric, '/cash?category=none', 'fin'
      FROM public.cashflow_entries e
      WHERE e.org_id = ANY (cash) AND e.category_id IS NULL;
    RETURN QUERY SELECT 'unallocated_payments', 'Платежи заказчиков без разнесения', '₽', coalesce(sum(p.amount - p.allocated_amount), 0), '/payments', 'fin'
      FROM public.client_payments p WHERE p.org_id = ANY (cash) AND p.amount > p.allocated_amount;
  END IF;

  IF cardinality(hire) > 0 THEN
    RETURN QUERY SELECT 'docs_expiring_30', 'Документы истекают за 30 дней', 'шт.', count(*)::numeric, '/workers', 'hire'
      FROM public.worker_documents wd JOIN public.workers w ON w.user_id = wd.worker_id AND w.org_id = wd.org_id
      WHERE wd.org_id = ANY (hire) AND wd.status = 'verified' AND wd.valid_until BETWEEN current_date AND current_date + 30 AND w.status <> 'not_working';
    RETURN QUERY SELECT 'no_shift_14', 'Допущены, но без смен 14 дней', 'чел.', count(*)::numeric, '/hiring/today', 'hire'
      FROM public.workers w
      WHERE w.org_id = ANY (hire) AND w.status = 'active' AND coalesce(w.admitted_at, w.created_at) < now() - interval '14 days'
        AND NOT EXISTS (SELECT 1 FROM public.assignments a WHERE a.worker_id = w.user_id AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked'));
  END IF;
END;
$$;

-- ============================================================
-- 5. План и факт выручки и маржи
-- ============================================================
-- Плановые суммы месяцев берутся пропорционально дням периода. Руководитель видит весь план, менеджер продаж — план по своим заказчикам.
CREATE OR REPLACE FUNCTION public.analytics_plan_fact(_org_ids uuid[], _from date, _to date)
RETURNS TABLE (revenue_plan numeric, revenue_fact numeric, margin_plan numeric, margin_fact numeric)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  fin uuid[] := private.analytics_orgs(_org_ids, 'fin');
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR cardinality(fin) = 0 THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  PERFORM private.refresh_analytics(fin);
  RETURN QUERY
  WITH f AS (
    SELECT coalesce(sum(d.revenue), 0) AS rev, coalesce(sum(d.margin), 0) AS mar FROM public.analytics_daily d
    WHERE d.org_id = ANY (fin) AND d.day BETWEEN _from AND _to AND private.analytics_client_ok(d.org_id, d.client_id, uid)
  ), p AS (
    SELECT pl.org_id, pl.article, pl.client_id,
           pl.amount * greatest(0, least(_to, (pl.month + interval '1 month - 1 day')::date) - greatest(_from, pl.month) + 1)
             / ((pl.month + interval '1 month')::date - pl.month) AS part
    FROM public.bdr_plans pl
    WHERE pl.org_id = ANY (fin) AND pl.month <= _to AND (pl.month + interval '1 month - 1 day')::date >= _from
      AND private.permission_scope(uid, pl.org_id, 'cashflow', 'view') = 'all'
  )
  SELECT (SELECT sum(p.part) FROM p WHERE p.article = 'revenue' AND (CASE WHEN p.client_id IS NULL THEN private.analytics_unrestricted(p.org_id, uid) ELSE private.analytics_client_ok(p.org_id, p.client_id, uid) END)),
         f.rev,
         (SELECT sum(CASE WHEN p.article = 'revenue' THEN p.part ELSE -p.part END) FROM p WHERE p.article IN ('revenue', 'worker_costs', 'worker_taxes', 'payout_fees') AND private.analytics_unrestricted(p.org_id, uid)),
         f.mar
  FROM f;
END;
$$;

-- ============================================================
-- 6. Кабинет заказчика
-- ============================================================
-- Укомплектованность и выход, часы и сумма по объектам, средняя оценка людей: только по своему заказчику.
CREATE OR REPLACE FUNCTION public.client_dashboard(_client_id uuid, _from date, _to date)
RETURNS TABLE (site_id uuid, site_name text, needed bigint, confirmed bigint, started_needed bigint, on_site bigint, hours numeric, amount numeric, avg_rating numeric)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  org uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_client_contact(_client_id) THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  SELECT c.org_id INTO org FROM public.clients c WHERE c.id = _client_id;
  PERFORM private.refresh_analytics(ARRAY[org]);
  RETURN QUERY
  SELECT st.id, st.name, coalesce(sum(d.needed), 0), coalesce(sum(d.confirmed), 0), coalesce(sum(d.started_needed), 0), coalesce(sum(d.on_site), 0), coalesce(sum(d.hours), 0),
         (SELECT coalesce(sum(a.amount_client), 0) FROM public.accruals a
           WHERE a.client_id = _client_id AND a.site_id = st.id AND a.visible_to_client AND a.status <> 'draft'
             AND private.accrual_date(a.kind, a.shift_date, a.period_month) BETWEEN _from AND _to),
         (SELECT round(avg(x.client_rating)::numeric, 2) FROM public.assignments x JOIN public.shifts s ON s.id = x.shift_id
           WHERE s.client_id = _client_id AND s.site_id = st.id AND s.shift_date BETWEEN _from AND _to AND x.client_rating IS NOT NULL)
  FROM public.sites st
  LEFT JOIN public.analytics_daily d ON d.site_id = st.id AND d.client_id = _client_id AND d.day BETWEEN _from AND _to
  WHERE st.client_id = _client_id
  GROUP BY st.id, st.name
  ORDER BY st.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.analytics_by_client(uuid[], date, date), public.analytics_by_site(uuid[], date, date), public.analytics_unconfirmed(uuid[], date),
  public.analytics_candidates(uuid[], date, date), public.analytics_counters(uuid[], date, date), public.analytics_plan_fact(uuid[], date, date),
  public.client_dashboard(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_by_client(uuid[], date, date), public.analytics_by_site(uuid[], date, date), public.analytics_unconfirmed(uuid[], date),
  public.analytics_candidates(uuid[], date, date), public.analytics_counters(uuid[], date, date), public.analytics_plan_fact(uuid[], date, date),
  public.client_dashboard(uuid, date, date) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.analytics_unrestricted(uuid, uuid), private.analytics_orgs(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.analytics_unrestricted(uuid, uuid), private.analytics_orgs(uuid[], text) TO authenticated, service_role;
