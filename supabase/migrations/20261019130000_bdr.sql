-- Этап 3, шаг 24: бюджет доходов и расходов (БДР): факт, план, план/факт.
-- ТЗ: раздел 16 (Ф-6, Ф-7, Ф-8).
--
-- БДР отвечает на вопрос «зарабатывает ли компания по плану». Выручка и затраты на исполнителей берутся из начислений по дате смены
-- (не из денег), прочие расходы — из ДДС по статьям, налог по УСН оценивается по режиму организации. Каждая цифра считается на сервере
-- одной функцией, поэтому в отчёте, в разрезах и на дашбордах она совпадает.

-- Дата, по которой начисление относится к периоду БДР: дата смены; корректировка — месяц, в котором её оформили.
CREATE OR REPLACE FUNCTION private.accrual_date(_kind text, _shift_date date, _period_month date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$ SELECT CASE WHEN _kind = 'correction' THEN _period_month ELSE _shift_date END $$;

-- ============================================================
-- 1. План
-- ============================================================
CREATE TABLE public.bdr_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Первое число месяца.
  month date NOT NULL CHECK (month = date_trunc('month', month)::date),
  article text NOT NULL CHECK (article IN ('revenue', 'worker_costs', 'worker_taxes', 'payout_fees', 'other_staff_costs', 'admin_costs')),
  -- План выручки можно вести по заказчикам; тогда он складывается из строк заказчиков.
  client_id uuid,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE CASCADE,
  CONSTRAINT bdr_plans_client_only_revenue CHECK (client_id IS NULL OR article = 'revenue')
);

CREATE UNIQUE INDEX bdr_plans_key ON public.bdr_plans (org_id, month, article, coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE TRIGGER audit_bdr_plans AFTER INSERT OR UPDATE OR DELETE ON public.bdr_plans
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('month', 'article', 'client_id', 'amount');

CREATE OR REPLACE FUNCTION public.save_bdr_plan(_org_id uuid, _month date, _article text, _amount numeric, _client_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'cashflow', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'Сумма плана не может быть отрицательной' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.bdr_plans (org_id, month, article, client_id, amount) VALUES (_org_id, date_trunc('month', _month)::date, _article, _client_id, _amount)
  ON CONFLICT (org_id, month, article, (coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid))) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now();
END;
$$;

-- ============================================================
-- 2. Факт
-- ============================================================
CREATE OR REPLACE FUNCTION private.bdr_fact(_org_ids uuid[], _from date, _to date)
RETURNS TABLE (org_id uuid, month date, article text, amount numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT a.org_id, date_trunc('month', private.accrual_date(a.kind, a.shift_date, a.period_month))::date, v.article, sum(v.amount)
  FROM public.accruals a
  CROSS JOIN LATERAL (VALUES ('revenue', a.amount_client), ('worker_costs', a.amount_worker), ('worker_taxes', a.taxes), ('payout_fees', a.payout_fee)) AS v(article, amount)
  WHERE a.org_id = ANY (_org_ids) AND a.status <> 'draft' AND private.accrual_date(a.kind, a.shift_date, a.period_month) BETWEEN _from AND _to
  GROUP BY 1, 2, 3
  UNION ALL
  SELECT e.org_id, date_trunc('month', e.entry_date)::date, c.bdr_article, sum(CASE e.direction WHEN 'out' THEN e.amount ELSE -e.amount END)
  FROM public.cashflow_entries e JOIN public.cashflow_categories c ON c.id = e.category_id
  WHERE e.org_id = ANY (_org_ids) AND e.entry_date BETWEEN _from AND _to AND c.bdr_article IN ('other_staff_costs', 'admin_costs') AND NOT c.is_transfer
  GROUP BY 1, 2, 3
$$;

-- Налог по режиму организации (оценка): УСН «доходы» 6% от выручки; УСН «доходы минус расходы» 15% от разницы, не меньше 1% выручки;
-- общая система — налог на прибыль 20% от операционной прибыли.
CREATE OR REPLACE FUNCTION private.estimate_tax(_regime text, _revenue numeric, _costs numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _regime
    WHEN 'usn6' THEN round(greatest(_revenue, 0) * 0.06, 2)
    WHEN 'usn15' THEN greatest(round(greatest(_revenue - _costs, 0) * 0.15, 2), round(greatest(_revenue, 0) * 0.01, 2))
    ELSE round(greatest(_revenue - _costs, 0) * 0.20, 2)
  END
$$;

-- ============================================================
-- 3. Отчёт план/факт
-- ============================================================
CREATE OR REPLACE FUNCTION public.bdr_report(_org_ids uuid[], _from date, _to date)
RETURNS TABLE (month date, article text, article_name text, sort_order integer, plan numeric, fact numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  allowed uuid[];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  SELECT array_agg(o) INTO allowed FROM unnest(_org_ids) o WHERE private.permission_scope(auth.uid(), o, 'cashflow', 'view') = 'all';
  IF allowed IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH f AS (SELECT * FROM private.bdr_fact(allowed, _from, _to)),
  p AS (SELECT pl.org_id, pl.month, pl.article, sum(pl.amount) AS amount FROM public.bdr_plans pl
        WHERE pl.org_id = ANY (allowed) AND pl.month BETWEEN date_trunc('month', _from)::date AND _to GROUP BY 1, 2, 3),
  keys AS (SELECT DISTINCT x.org_id, x.month FROM (SELECT f.org_id, f.month FROM f UNION SELECT p.org_id, p.month FROM p) x),
  piv AS (
    SELECT k.org_id, k.month, o.tax_regime,
      coalesce((SELECT sum(f.amount) FROM f WHERE f.org_id = k.org_id AND f.month = k.month AND f.article = 'revenue'), 0) AS rev_f,
      coalesce((SELECT sum(f.amount) FROM f WHERE f.org_id = k.org_id AND f.month = k.month AND f.article <> 'revenue'), 0) AS cost_f,
      coalesce((SELECT sum(p.amount) FROM p WHERE p.org_id = k.org_id AND p.month = k.month AND p.article = 'revenue'), 0) AS rev_p,
      coalesce((SELECT sum(p.amount) FROM p WHERE p.org_id = k.org_id AND p.month = k.month AND p.article <> 'revenue'), 0) AS cost_p
    FROM keys k JOIN public.organizations o ON o.id = k.org_id
  ),
  base AS (
    SELECT x.month, x.article, sum(x.plan) AS plan, sum(x.fact) AS fact FROM (
      SELECT f.month, f.article, 0::numeric AS plan, f.amount AS fact FROM f
      UNION ALL SELECT p.month, p.article, p.amount, 0::numeric FROM p
    ) x GROUP BY 1, 2
  ),
  calc AS (
    SELECT piv.month, sum(piv.rev_p - piv.cost_p) AS op_p, sum(piv.rev_f - piv.cost_f) AS op_f,
           sum(private.estimate_tax(piv.tax_regime, piv.rev_p, piv.cost_p)) AS tax_p, sum(private.estimate_tax(piv.tax_regime, piv.rev_f, piv.cost_f)) AS tax_f
    FROM piv GROUP BY piv.month
  ),
  names(article, article_name, sort_order) AS (VALUES
    ('revenue', 'Выручка', 10), ('worker_costs', 'Затраты на исполнителей', 20), ('worker_taxes', 'Налоги и взносы по исполнителям', 30),
    ('payout_fees', 'Комиссии выплат', 40), ('other_staff_costs', 'Прочие расходы на персонал', 50), ('admin_costs', 'Управленческие расходы', 60))
  SELECT b.month, b.article, n.article_name, n.sort_order, b.plan, b.fact FROM base b JOIN names n ON n.article = b.article
  UNION ALL SELECT c.month, 'operating_profit', 'Операционная прибыль', 70, c.op_p, c.op_f FROM calc c
  UNION ALL SELECT c.month, 'usn_tax', 'Налог по УСН (оценка)', 80, c.tax_p, c.tax_f FROM calc c
  UNION ALL SELECT c.month, 'net_profit', 'Чистая прибыль', 90, c.op_p - c.tax_p, c.op_f - c.tax_f FROM calc c
  ORDER BY 1, 4;
END;
$$;

-- Разрезы выручки и затрат на исполнителей: заказчик, объект, менеджер продаж, организация.
CREATE OR REPLACE FUNCTION public.bdr_breakdown(_org_ids uuid[], _from date, _to date, _dimension text)
RETURNS TABLE (key text, name text, revenue numeric, worker_costs numeric, margin numeric, margin_pct numeric)
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
  SELECT g.k, coalesce(g.n, 'Не указан'), g.rev, g.wc, g.rev - g.wc, CASE WHEN g.rev > 0 THEN round((g.rev - g.wc) / g.rev * 100, 1) END
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

-- ============================================================
-- 4. Копирование факта прошлого года в план
-- ============================================================
-- План на год берётся из факта прошлого года с процентом роста (выручка — по заказчикам). Прежний план этого года заменяется.
CREATE OR REPLACE FUNCTION public.copy_bdr_plan(_org_id uuid, _from_year integer, _to_year integer, _growth_pct numeric DEFAULT 0)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  k numeric := 1 + coalesce(_growth_pct, 0) / 100;
  n integer;
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'cashflow', 'update') <> 'all' THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF _to_year <= _from_year OR k < 0 THEN RAISE EXCEPTION 'Год плана должен быть позже базового, рост — не меньше −100%%' USING ERRCODE = '22023'; END IF;
  DELETE FROM public.bdr_plans WHERE org_id = _org_id AND extract(year FROM month)::integer = _to_year;
  INSERT INTO public.bdr_plans (org_id, month, article, client_id, amount)
  SELECT _org_id, (m.month + make_interval(years => _to_year - _from_year))::date, m.article, m.client_id, round(greatest(m.amount, 0) * k, 2)
  FROM (
    SELECT date_trunc('month', private.accrual_date(a.kind, a.shift_date, a.period_month))::date AS month, 'revenue'::text AS article, a.client_id, sum(a.amount_client) AS amount
    FROM public.accruals a
    WHERE a.org_id = _org_id AND a.status <> 'draft' AND extract(year FROM private.accrual_date(a.kind, a.shift_date, a.period_month))::integer = _from_year
    GROUP BY 1, 3
    UNION ALL
    SELECT f.month, f.article, NULL::uuid, f.amount FROM private.bdr_fact(ARRAY[_org_id], make_date(_from_year, 1, 1), make_date(_from_year, 12, 31)) f WHERE f.article <> 'revenue'
  ) m WHERE m.amount > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_bdr_plan(uuid, date, text, numeric, uuid), public.bdr_report(uuid[], date, date), public.bdr_breakdown(uuid[], date, date, text),
  public.copy_bdr_plan(uuid, integer, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_bdr_plan(uuid, date, text, numeric, uuid), public.bdr_report(uuid[], date, date), public.bdr_breakdown(uuid[], date, date, text),
  public.copy_bdr_plan(uuid, integer, integer, numeric) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.bdr_fact(uuid[], date, date), private.estimate_tax(text, numeric, numeric), private.accrual_date(text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.bdr_fact(uuid[], date, date), private.estimate_tax(text, numeric, numeric), private.accrual_date(text, date, date) TO service_role;

ALTER TABLE public.bdr_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bdr_plans FROM anon, authenticated;
GRANT SELECT ON public.bdr_plans TO authenticated;
GRANT ALL ON public.bdr_plans TO service_role;
CREATE POLICY "BDR plans: view" ON public.bdr_plans FOR SELECT TO authenticated USING (private.permission_scope(auth.uid(), org_id, 'cashflow', 'view') = 'all');
