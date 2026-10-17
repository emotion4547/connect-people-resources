-- Этап 3, шаг 25: метрики и агрегаты аналитики.
-- ТЗ: раздел 17 (Ан-1…Ан-3).
--
-- Каждая метрика считается на сервере одной функцией по единому определению, поэтому число на дашборде руководителя и отдела одно и то же.
-- Операционные и финансовые показатели по дням хранятся отдельно (analytics_daily) и пересчитываются при изменении данных: триггеры
-- помечают затронутые дни, а чтение пересчитывает помеченные дни и дни, посчитанные до их окончания. Поэтому цифры всегда свежие, а
-- дашборд за 12 месяцев читает готовые строки.

-- ============================================================
-- 1. Агрегаты по дням
-- ============================================================
CREATE TABLE public.analytics_daily (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  day date NOT NULL,
  client_id uuid NOT NULL,
  site_id uuid NOT NULL,
  shifts integer NOT NULL DEFAULT 0,
  needed integer NOT NULL DEFAULT 0,
  confirmed integer NOT NULL DEFAULT 0,
  started_needed integer NOT NULL DEFAULT 0,
  on_site integer NOT NULL DEFAULT 0,
  started_assigned integer NOT NULL DEFAULT 0,
  no_shows integer NOT NULL DEFAULT 0,
  hours numeric(12,2) NOT NULL DEFAULT 0,
  revenue numeric(14,2) NOT NULL DEFAULT 0,
  worker_costs numeric(14,2) NOT NULL DEFAULT 0,
  margin numeric(14,2) NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, day, client_id, site_id)
);

CREATE INDEX analytics_daily_day_idx ON public.analytics_daily (org_id, day);

CREATE TABLE public.analytics_dirty (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  day date NOT NULL,
  PRIMARY KEY (org_id, day)
);

ALTER TABLE public.analytics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_dirty ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_daily, public.analytics_dirty FROM anon, authenticated;
GRANT ALL ON public.analytics_daily, public.analytics_dirty TO service_role;

-- Пометка затронутых дней.
CREATE OR REPLACE FUNCTION private.mark_analytics_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    INSERT INTO public.analytics_dirty (org_id, day) VALUES (NEW.org_id, NEW.shift_date) ON CONFLICT DO NOTHING;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    INSERT INTO public.analytics_dirty (org_id, day) VALUES (OLD.org_id, OLD.shift_date) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.mark_analytics_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    INSERT INTO public.analytics_dirty (org_id, day) SELECT NEW.org_id, s.shift_date FROM public.shifts s WHERE s.id = NEW.shift_id ON CONFLICT DO NOTHING;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    INSERT INTO public.analytics_dirty (org_id, day) SELECT OLD.org_id, s.shift_date FROM public.shifts s WHERE s.id = OLD.shift_id ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.mark_analytics_accrual()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    INSERT INTO public.analytics_dirty (org_id, day) VALUES (NEW.org_id, private.accrual_date(NEW.kind, NEW.shift_date, NEW.period_month)) ON CONFLICT DO NOTHING;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    INSERT INTO public.analytics_dirty (org_id, day) VALUES (OLD.org_id, private.accrual_date(OLD.kind, OLD.shift_date, OLD.period_month)) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER analytics_mark_shift AFTER INSERT OR UPDATE OR DELETE ON public.shifts FOR EACH ROW EXECUTE FUNCTION private.mark_analytics_shift();
CREATE TRIGGER analytics_mark_assignment AFTER INSERT OR UPDATE OR DELETE ON public.assignments FOR EACH ROW EXECUTE FUNCTION private.mark_analytics_assignment();
CREATE TRIGGER analytics_mark_accrual AFTER INSERT OR UPDATE OR DELETE ON public.accruals FOR EACH ROW EXECUTE FUNCTION private.mark_analytics_accrual();

-- Пересчёт одного дня организации.
CREATE OR REPLACE FUNCTION private.refresh_analytics_day(_org_id uuid, _day date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  DELETE FROM public.analytics_daily WHERE org_id = _org_id AND day = _day;
  INSERT INTO public.analytics_daily (org_id, day, client_id, site_id, shifts, needed, confirmed, started_needed, on_site, started_assigned, no_shows,
                                      hours, revenue, worker_costs, margin, computed_at)
  SELECT _org_id, _day, k.client_id, k.site_id,
         coalesce(o.shifts, 0), coalesce(o.needed, 0), coalesce(o.confirmed, 0), coalesce(o.started_needed, 0), coalesce(o.on_site, 0),
         coalesce(o.started_assigned, 0), coalesce(o.no_shows, 0), coalesce(o.hours, 0),
         coalesce(f.revenue, 0), coalesce(f.worker_costs, 0), coalesce(f.margin, 0), now()
  FROM (
    SELECT s.client_id, s.site_id FROM public.shifts s WHERE s.org_id = _org_id AND s.shift_date = _day AND s.status <> 'cancelled'
    UNION
    SELECT a.client_id, a.site_id FROM public.accruals a
    WHERE a.org_id = _org_id AND a.status <> 'draft' AND private.accrual_date(a.kind, a.shift_date, a.period_month) = _day
  ) k
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS shifts, sum(s.headcount)::integer AS needed, sum(least(s.headcount, c.confirmed))::integer AS confirmed,
           (sum(s.headcount) FILTER (WHERE s.start_at <= now()))::integer AS started_needed,
           (sum(least(s.headcount, c.on_site)) FILTER (WHERE s.start_at <= now()))::integer AS on_site,
           (sum(c.assigned) FILTER (WHERE s.start_at <= now()))::integer AS started_assigned,
           (sum(c.no_show) FILTER (WHERE s.start_at <= now()))::integer AS no_shows,
           sum(c.hours) AS hours
    FROM public.shifts s
    CROSS JOIN LATERAL (
      SELECT count(*) FILTER (WHERE a.status IN ('confirmed', 'on_site', 'worked')) AS confirmed,
             count(*) FILTER (WHERE a.status IN ('on_site', 'worked')) AS on_site,
             count(*) FILTER (WHERE a.status IN ('assigned', 'confirmed', 'on_site', 'worked', 'no_show')) AS assigned,
             count(*) FILTER (WHERE a.status = 'no_show') AS no_show,
             coalesce(sum(coalesce(a.approved_hours, a.actual_hours)) FILTER (WHERE a.status = 'worked'), 0) AS hours
      FROM public.assignments a WHERE a.shift_id = s.id AND NOT a.is_reserve
    ) c
    WHERE s.org_id = _org_id AND s.shift_date = _day AND s.status <> 'cancelled' AND s.client_id = k.client_id AND s.site_id = k.site_id
  ) o ON true
  LEFT JOIN LATERAL (
    SELECT sum(a.amount_client) AS revenue, sum(a.amount_worker) AS worker_costs, sum(a.margin) AS margin
    FROM public.accruals a
    WHERE a.org_id = _org_id AND a.status <> 'draft' AND a.client_id = k.client_id AND a.site_id = k.site_id
      AND private.accrual_date(a.kind, a.shift_date, a.period_month) = _day
  ) f ON true;
  DELETE FROM public.analytics_dirty WHERE org_id = _org_id AND day = _day;
END;
$$;

-- Пересчёт помеченных дней и дней, посчитанных до их окончания (смены в них могли начаться позже).
CREATE OR REPLACE FUNCTION private.refresh_analytics(_org_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT org_id, day FROM public.analytics_dirty WHERE org_id = ANY (_org_ids)
    UNION
    SELECT org_id, day FROM public.analytics_daily WHERE org_id = ANY (_org_ids) AND day <= current_date AND computed_at < (day + 1)::timestamptz
    ORDER BY 1, 2
  LOOP
    PERFORM private.refresh_analytics_day(r.org_id, r.day);
  END LOOP;
END;
$$;

-- Существующие данные: все дни смен и начислений помечаются, первое чтение их пересчитает.
INSERT INTO public.analytics_dirty (org_id, day)
SELECT org_id, shift_date FROM public.shifts
UNION SELECT org_id, private.accrual_date(kind, shift_date, period_month) FROM public.accruals
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. Права: какие группы показателей видит пользователь
-- ============================================================
-- Группа открывается, если у роли есть доступ к аналитике и к данным, из которых показатель складывается.
CREATE OR REPLACE FUNCTION private.analytics_groups(_org_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT CASE WHEN private.permission_scope(auth.uid(), _org_id, 'analytics', 'view') = 'none' THEN ARRAY[]::text[]
    ELSE array_remove(ARRAY[
      CASE WHEN private.permission_scope(auth.uid(), _org_id, 'orders', 'view') <> 'none' THEN 'ops' END,
      CASE WHEN private.permission_scope(auth.uid(), _org_id, 'accruals', 'view') <> 'none' THEN 'fin' END,
      CASE WHEN private.permission_scope(auth.uid(), _org_id, 'candidates', 'view') <> 'none' THEN 'hire' END
    ], NULL) END
$$;

-- Менеджер продаж видит своих заказчиков, менеджер объектов — заказчиков своих объектов, остальные роли — всех.
CREATE OR REPLACE FUNCTION private.analytics_client_ok(_org_id uuid, _client_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT coalesce(bool_or(CASE ur.role::text
    WHEN 'sales' THEN EXISTS (SELECT 1 FROM public.clients c WHERE c.id = _client_id AND c.sales_manager_id = _user_id)
    WHEN 'site_manager' THEN EXISTS (SELECT 1 FROM public.clients c WHERE c.id = _client_id AND c.sites_manager_id = _user_id)
                          OR EXISTS (SELECT 1 FROM public.sites s WHERE s.client_id = _client_id AND s.site_manager_id = _user_id)
    ELSE true END), false)
  FROM public.user_roles ur WHERE ur.user_id = _user_id AND ur.org_id = _org_id
$$;

-- ============================================================
-- 3. Метрики
-- ============================================================
-- Части метрики: числитель и знаменатель (для отношений) или значение в числителе (для сумм и медиан).
CREATE OR REPLACE FUNCTION private.analytics_parts(_org_ids uuid[], _from date, _to date, _client uuid)
RETURNS TABLE (metric text, num numeric, den numeric)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  uid uuid := auth.uid();
  ops uuid[]; fin uuid[]; hire uuid[];
BEGIN
  SELECT coalesce(array_agg(o) FILTER (WHERE 'ops' = ANY (g)), ARRAY[]::uuid[]), coalesce(array_agg(o) FILTER (WHERE 'fin' = ANY (g)), ARRAY[]::uuid[]),
         coalesce(array_agg(o) FILTER (WHERE 'hire' = ANY (g)), ARRAY[]::uuid[])
    INTO ops, fin, hire
  FROM (SELECT o, private.analytics_groups(o) AS g FROM unnest(_org_ids) o) x;
  PERFORM private.refresh_analytics(ops || fin);

  IF cardinality(ops) > 0 THEN
    RETURN QUERY
    WITH d AS (
      SELECT * FROM public.analytics_daily x
      WHERE x.org_id = ANY (ops) AND x.day BETWEEN _from AND _to AND (_client IS NULL OR x.client_id = _client) AND private.analytics_client_ok(x.org_id, x.client_id, uid)
    )
    SELECT 'staffing', coalesce(sum(confirmed), 0)::numeric, coalesce(sum(needed), 0)::numeric FROM d
    UNION ALL SELECT 'attendance', coalesce(sum(on_site), 0)::numeric, coalesce(sum(started_needed), 0)::numeric FROM d
    UNION ALL SELECT 'no_show', coalesce(sum(no_shows), 0)::numeric, coalesce(sum(started_assigned), 0)::numeric FROM d
    UNION ALL SELECT 'hours', coalesce(sum(hours), 0), 1::numeric FROM d;

    -- Время закрытия заказа: от принятия до полной укомплектованности первой смены (когда назначен последний из нужных).
    RETURN QUERY
    WITH o AS (
      SELECT od.id, od.accepted_at FROM public.orders od
      WHERE od.org_id = ANY (ops) AND od.accepted_at >= _from AND od.accepted_at < _to + 1 AND (_client IS NULL OR od.client_id = _client)
        AND private.analytics_client_ok(od.org_id, od.client_id, uid)
    ), fs AS (
      SELECT DISTINCT ON (s.order_id) s.id AS shift_id, s.order_id, s.headcount FROM public.shifts s JOIN o ON o.id = s.order_id
      WHERE s.status <> 'cancelled' ORDER BY s.order_id, s.shift_date
    ), t AS (
      SELECT o.accepted_at, (SELECT q.created_at FROM (
               SELECT a.created_at, row_number() OVER (ORDER BY a.created_at) AS rn FROM public.assignments a
               WHERE a.shift_id = fs.shift_id AND NOT a.is_reserve AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked')) q WHERE q.rn = fs.headcount) AS full_at
      FROM fs JOIN o ON o.id = fs.order_id
    )
    SELECT 'order_close_hours', coalesce(round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (full_at - accepted_at)) / 3600))::numeric, 1), 0), count(*)::numeric
    FROM t WHERE full_at IS NOT NULL;

    RETURN QUERY
    SELECT 'active_base', count(DISTINCT a.worker_id)::numeric, 1::numeric
    FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id
    WHERE a.org_id = ANY (ops) AND a.status = 'worked' AND a.shift_start::date BETWEEN _to - 29 AND _to AND (_client IS NULL OR s.client_id = _client)
      AND private.analytics_client_ok(s.org_id, s.client_id, uid);
  END IF;

  IF cardinality(fin) > 0 THEN
    RETURN QUERY
    WITH d AS (
      SELECT * FROM public.analytics_daily x
      WHERE x.org_id = ANY (fin) AND x.day BETWEEN _from AND _to AND (_client IS NULL OR x.client_id = _client) AND private.analytics_client_ok(x.org_id, x.client_id, uid)
    )
    SELECT 'revenue', coalesce(sum(revenue), 0), 1::numeric FROM d
    UNION ALL SELECT 'worker_costs', coalesce(sum(worker_costs), 0), 1::numeric FROM d
    UNION ALL SELECT 'margin_amount', coalesce(sum(margin), 0), 1::numeric FROM d
    UNION ALL SELECT 'margin_pct', coalesce(sum(margin), 0), coalesce(sum(revenue), 0) FROM d;

    RETURN QUERY
    SELECT 'overdue_receivables', coalesce(sum(private.invoice_outstanding(i.id)) FILTER (WHERE i.due_date < current_date), 0), 1::numeric
    FROM public.client_documents i
    WHERE i.org_id = ANY (fin) AND i.kind = 'invoice' AND i.status IN ('issued', 'signed', 'paid_partial') AND (_client IS NULL OR i.client_id = _client)
      AND private.analytics_client_ok(i.org_id, i.client_id, uid)
    UNION ALL
    SELECT 'receivables_total', coalesce(sum(private.invoice_outstanding(i.id)), 0), 1::numeric
    FROM public.client_documents i
    WHERE i.org_id = ANY (fin) AND i.kind = 'invoice' AND i.status IN ('issued', 'signed', 'paid_partial') AND (_client IS NULL OR i.client_id = _client)
      AND private.analytics_client_ok(i.org_id, i.client_id, uid);
  END IF;

  IF cardinality(hire) > 0 AND _client IS NULL THEN
    -- Удержание: допущенные в периоде, у которых прошло N дней, и из них те, кто отработал смену не раньше чем через N дней после допуска.
    RETURN QUERY
    SELECT 'retention_' || v.n, coalesce(c.kept, 0)::numeric, coalesce(c.total, 0)::numeric
    FROM (VALUES (30), (60), (90)) v(n)
    LEFT JOIN LATERAL (
      SELECT count(*) AS total,
             count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.assignments a WHERE a.worker_id = w.user_id AND a.org_id = w.org_id AND a.status = 'worked'
                                            AND a.shift_start >= w.admitted_at + make_interval(days => v.n))) AS kept
      FROM public.workers w
      WHERE w.org_id = ANY (hire) AND w.admitted_at::date BETWEEN _from AND _to AND w.admitted_at + make_interval(days => v.n) <= now()
    ) c ON true;

    RETURN QUERY
    SELECT 'hire_conversion', count(*) FILTER (WHERE c.stage = 'admitted')::numeric, count(*)::numeric
    FROM public.candidates c WHERE c.org_id = ANY (hire) AND c.created_at::date BETWEEN _from AND _to;

    RETURN QUERY
    SELECT 'time_to_admit_days',
           coalesce(round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (w.admitted_at - c.created_at)) / 86400))::numeric, 1), 0), count(*)::numeric
    FROM public.candidates c JOIN public.workers w ON w.user_id = c.admitted_worker_id AND w.org_id = c.org_id
    WHERE c.org_id = ANY (hire) AND c.created_at::date BETWEEN _from AND _to AND c.stage = 'admitted' AND w.admitted_at IS NOT NULL;
  END IF;
END;
$$;

-- Метрики периода: значение, числитель и знаменатель.
CREATE OR REPLACE FUNCTION public.analytics_metrics(_org_ids uuid[], _from date, _to date, _client_id uuid DEFAULT NULL)
RETURNS TABLE (metric text, name text, unit text, value numeric, num numeric, den numeric, sort_order integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF _to < _from THEN RAISE EXCEPTION 'Конец периода раньше начала' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(_org_ids) o WHERE cardinality(private.analytics_groups(o)) > 0) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH p AS (SELECT x.metric, x.num, x.den FROM private.analytics_parts(_org_ids, _from, _to, _client_id) x),
  defs(metric, name, unit, kind, sort_order) AS (VALUES
    ('staffing', 'Укомплектованность', '%', 'ratio', 10), ('attendance', 'Выход на объект', '%', 'ratio', 20), ('no_show', 'Неявки', '%', 'ratio', 30),
    ('order_close_hours', 'Время закрытия заказа', 'ч', 'median', 40), ('hours', 'Отработано часов', 'ч', 'sum', 45),
    ('revenue', 'Выручка', '₽', 'sum', 50), ('worker_costs', 'Затраты на исполнителей', '₽', 'sum', 55), ('margin_amount', 'Маржа', '₽', 'sum', 60),
    ('margin_pct', 'Маржинальность', '%', 'ratio', 65), ('active_base', 'Активная база', 'чел.', 'sum', 70),
    ('retention_30', 'Удержание 30 дней', '%', 'ratio', 71), ('retention_60', 'Удержание 60 дней', '%', 'ratio', 72), ('retention_90', 'Удержание 90 дней', '%', 'ratio', 73),
    ('hire_conversion', 'Конверсия найма', '%', 'ratio', 80), ('time_to_admit_days', 'Время до допуска', 'дн.', 'median', 85),
    ('overdue_receivables', 'Просроченная дебиторка', '₽', 'sum', 90), ('receivables_total', 'Дебиторка всего', '₽', 'sum', 91))
  SELECT d.metric, d.name, d.unit,
         CASE d.kind WHEN 'ratio' THEN CASE WHEN p.den > 0 THEN round(p.num / p.den * 100, 1) END ELSE round(p.num, 2) END,
         p.num, p.den, d.sort_order
  FROM p JOIN defs d ON d.metric = p.metric ORDER BY d.sort_order;
END;
$$;

-- Сравнение с прошлым периодом той же длины.
CREATE OR REPLACE FUNCTION public.analytics_compare(_org_ids uuid[], _from date, _to date, _client_id uuid DEFAULT NULL)
RETURNS TABLE (metric text, name text, unit text, value numeric, prev_value numeric, delta numeric, sort_order integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  len integer := _to - _from + 1;
  prev_to date := _from - 1;
BEGIN
  RETURN QUERY
  SELECT c.metric, c.name, c.unit, c.value, p.value, c.value - p.value, c.sort_order
  FROM public.analytics_metrics(_org_ids, _from, _to, _client_id) c
  LEFT JOIN public.analytics_metrics(_org_ids, prev_to - len + 1, prev_to, _client_id) p ON p.metric = c.metric
  ORDER BY c.sort_order;
END;
$$;

-- Динамика для графиков: по дням или месяцам, из готовых агрегатов.
CREATE OR REPLACE FUNCTION public.analytics_series(_org_ids uuid[], _from date, _to date, _bucket text DEFAULT 'month', _client_id uuid DEFAULT NULL)
RETURNS TABLE (bucket date, needed bigint, confirmed bigint, started_needed bigint, on_site bigint, started_assigned bigint, no_shows bigint,
               revenue numeric, worker_costs numeric, margin numeric)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  ops uuid[]; fin uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF _bucket NOT IN ('day', 'week', 'month') THEN RAISE EXCEPTION 'Неизвестный шаг' USING ERRCODE = '22023'; END IF;
  SELECT coalesce(array_agg(o) FILTER (WHERE 'ops' = ANY (g)), ARRAY[]::uuid[]), coalesce(array_agg(o) FILTER (WHERE 'fin' = ANY (g)), ARRAY[]::uuid[])
    INTO ops, fin FROM (SELECT o, private.analytics_groups(o) AS g FROM unnest(_org_ids) o) x;
  IF cardinality(ops) + cardinality(fin) = 0 THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  PERFORM private.refresh_analytics(ops || fin);
  RETURN QUERY
  SELECT date_trunc(_bucket, x.day)::date,
         sum(x.needed) FILTER (WHERE x.org_id = ANY (ops)), sum(x.confirmed) FILTER (WHERE x.org_id = ANY (ops)),
         sum(x.started_needed) FILTER (WHERE x.org_id = ANY (ops)), sum(x.on_site) FILTER (WHERE x.org_id = ANY (ops)),
         sum(x.started_assigned) FILTER (WHERE x.org_id = ANY (ops)), sum(x.no_shows) FILTER (WHERE x.org_id = ANY (ops)),
         sum(x.revenue) FILTER (WHERE x.org_id = ANY (fin)), sum(x.worker_costs) FILTER (WHERE x.org_id = ANY (fin)), sum(x.margin) FILTER (WHERE x.org_id = ANY (fin))
  FROM public.analytics_daily x
  WHERE x.org_id = ANY (ops || fin) AND x.day BETWEEN _from AND _to AND (_client_id IS NULL OR x.client_id = _client_id)
    AND private.analytics_client_ok(x.org_id, x.client_id, auth.uid())
  GROUP BY 1 ORDER BY 1;
END;
$$;

-- ============================================================
-- 4. Записи, из которых сложилось число (Ан-1)
-- ============================================================
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
    FROM public.shifts s
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
    FROM public.accruals a
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

REVOKE EXECUTE ON FUNCTION public.analytics_metrics(uuid[], date, date, uuid), public.analytics_compare(uuid[], date, date, uuid),
  public.analytics_series(uuid[], date, date, text, uuid), public.analytics_records(uuid[], text, date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_metrics(uuid[], date, date, uuid), public.analytics_compare(uuid[], date, date, uuid),
  public.analytics_series(uuid[], date, date, text, uuid), public.analytics_records(uuid[], text, date, date, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.refresh_analytics_day(uuid, date), private.refresh_analytics(uuid[]), private.analytics_parts(uuid[], date, date, uuid),
  private.mark_analytics_shift(), private.mark_analytics_assignment(), private.mark_analytics_accrual() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.refresh_analytics_day(uuid, date), private.refresh_analytics(uuid[]), private.analytics_parts(uuid[], date, date, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION private.analytics_groups(uuid), private.analytics_client_ok(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.analytics_groups(uuid), private.analytics_client_ok(uuid, uuid, uuid) TO authenticated, service_role;
