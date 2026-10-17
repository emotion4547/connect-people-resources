-- Этап 3, шаг 29: вахты.
-- ТЗ: раздел 18 (ВХ-1…ВХ-3).
--
-- Вахта — обычный заказ со сменами, к которому добавлены условия проезда и проживания. Исполнители на вахте (состав) берутся из назначений и
-- живут в общем жилье; календарь показывает, кто где, заезды, выезды и свободные места. Суточные и компенсация проезда выплачиваются
-- отдельными начислениями по правилам заказа (и при необходимости выставляются заказчику), а расходы на проживание и питание идут в БДР
-- статьёй «Проживание и питание вахт».

ALTER TABLE public.orders ADD COLUMN kind text NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular', 'rotation'));

-- Новые виды начислений: суточные и проезд.
ALTER TABLE public.accruals DROP CONSTRAINT accruals_kind_check;
ALTER TABLE public.accruals ADD CONSTRAINT accruals_kind_check CHECK (kind IN ('main', 'bonus', 'deduction', 'client_penalty', 'correction', 'per_diem', 'travel'));
ALTER TABLE public.accruals DROP CONSTRAINT accruals_signs;
ALTER TABLE public.accruals ADD CONSTRAINT accruals_signs CHECK (
  (kind = 'bonus' AND amount_worker >= 0) OR (kind = 'deduction' AND amount_worker <= 0)
  OR (kind = 'client_penalty' AND amount_client >= 0) OR (kind IN ('per_diem', 'travel') AND amount_worker >= 0 AND amount_client >= 0)
  OR kind IN ('main', 'correction'));
ALTER TABLE public.accruals DROP CONSTRAINT accruals_manual_needs_reason;
ALTER TABLE public.accruals ADD CONSTRAINT accruals_manual_needs_reason CHECK (kind IN ('main', 'per_diem', 'travel') OR reason_id IS NOT NULL);
ALTER TABLE public.client_document_lines DROP CONSTRAINT client_document_lines_line_kind_check;
ALTER TABLE public.client_document_lines ADD CONSTRAINT client_document_lines_line_kind_check CHECK (line_kind IN ('work', 'late', 'correction', 'penalty', 'rotation'));
ALTER TABLE public.bdr_plans DROP CONSTRAINT bdr_plans_article_check;
ALTER TABLE public.bdr_plans ADD CONSTRAINT bdr_plans_article_check CHECK (article IN ('revenue', 'worker_costs', 'worker_taxes', 'payout_fees', 'other_staff_costs', 'admin_costs', 'rotation_costs'));

-- ============================================================
-- 1. Условия вахты, состав, выданные начисления
-- ============================================================
CREATE TABLE public.order_rotations (
  order_id uuid PRIMARY KEY,
  org_id uuid NOT NULL,
  arrival_date date NOT NULL,
  departure_date date NOT NULL,
  housing_address text,
  housing_beds integer NOT NULL DEFAULT 0 CHECK (housing_beds >= 0),
  -- Наши затраты на одно место в сутки и на питание одного человека в сутки.
  housing_cost_per_bed_day numeric(10,2) NOT NULL DEFAULT 0 CHECK (housing_cost_per_bed_day >= 0),
  meals boolean NOT NULL DEFAULT false,
  meals_cost_per_day numeric(10,2) NOT NULL DEFAULT 0 CHECK (meals_cost_per_day >= 0),
  -- Суточные: исполнителю в сутки и заказчику в сутки (0 — заказчику не выставляется); проезд: разово.
  per_diem_worker numeric(10,2) NOT NULL DEFAULT 0 CHECK (per_diem_worker >= 0),
  per_diem_client numeric(10,2) NOT NULL DEFAULT 0 CHECK (per_diem_client >= 0),
  travel_worker numeric(10,2) NOT NULL DEFAULT 0 CHECK (travel_worker >= 0),
  travel_client numeric(10,2) NOT NULL DEFAULT 0 CHECK (travel_client >= 0),
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, order_id) REFERENCES public.orders (org_id, id) ON DELETE CASCADE,
  CONSTRAINT order_rotations_dates CHECK (departure_date >= arrival_date)
);

CREATE TABLE public.rotation_members (
  order_id uuid NOT NULL,
  org_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  arrival_date date NOT NULL,
  departure_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, worker_id),
  FOREIGN KEY (order_id) REFERENCES public.order_rotations (order_id) ON DELETE CASCADE,
  FOREIGN KEY (org_id, worker_id) REFERENCES public.workers (org_id, user_id) ON DELETE CASCADE,
  CONSTRAINT rotation_members_dates CHECK (departure_date >= arrival_date)
);

CREATE INDEX rotation_members_dates_idx ON public.rotation_members (org_id, arrival_date, departure_date);

CREATE TABLE public.rotation_accruals (
  order_id uuid NOT NULL,
  worker_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('per_diem', 'travel')),
  month date NOT NULL,
  accrual_id uuid NOT NULL REFERENCES public.accruals(id) ON DELETE RESTRICT,
  PRIMARY KEY (order_id, worker_id, kind, month)
);

ALTER TABLE public.order_rotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rotation_accruals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_rotations, public.rotation_members, public.rotation_accruals FROM anon, authenticated;
GRANT ALL ON public.order_rotations, public.rotation_members, public.rotation_accruals TO service_role;
GRANT SELECT ON public.order_rotations, public.rotation_members TO authenticated;
CREATE POLICY "Rotations: view with order" ON public.order_rotations FOR SELECT TO authenticated USING (private.order_in_scope(order_id, 'view'));
CREATE POLICY "Rotation members: view with order" ON public.rotation_members FOR SELECT TO authenticated USING (private.order_in_scope(order_id, 'view'));

CREATE TRIGGER audit_order_rotations AFTER INSERT OR UPDATE OR DELETE ON public.order_rotations
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('order_id', 'arrival_date', 'departure_date', 'housing_beds', 'per_diem_worker', 'per_diem_client', 'travel_worker', 'travel_client');

-- ============================================================
-- 2. Управление вахтой
-- ============================================================
-- Все назначенные на смены заказа становятся составом вахты (даты заезда и выезда — как у вахты).
CREATE OR REPLACE FUNCTION private.sync_rotation_members(_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO public.rotation_members (order_id, org_id, worker_id, arrival_date, departure_date)
  SELECT r.order_id, r.org_id, a.worker_id, r.arrival_date, r.departure_date
  FROM public.order_rotations r
  JOIN public.shifts s ON s.order_id = r.order_id
  JOIN public.assignments a ON a.shift_id = s.id AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked') AND NOT a.is_reserve
  WHERE r.order_id = _order_id
  GROUP BY r.order_id, r.org_id, a.worker_id, r.arrival_date, r.departure_date
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION private.rotation_member_on_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NEW.status IN ('assigned', 'confirmed', 'on_site', 'worked') AND NOT NEW.is_reserve THEN
    INSERT INTO public.rotation_members (order_id, org_id, worker_id, arrival_date, departure_date)
    SELECT r.order_id, r.org_id, NEW.worker_id, r.arrival_date, r.departure_date
    FROM public.shifts s JOIN public.order_rotations r ON r.order_id = s.order_id WHERE s.id = NEW.shift_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER rotation_member_assignment AFTER INSERT OR UPDATE OF status, is_reserve ON public.assignments FOR EACH ROW EXECUTE FUNCTION private.rotation_member_on_assignment();

CREATE OR REPLACE FUNCTION public.set_order_rotation(
  _order_id uuid, _arrival date, _departure date, _address text, _beds integer, _bed_cost numeric, _meals boolean, _meals_cost numeric,
  _per_diem_worker numeric, _per_diem_client numeric, _travel_worker numeric, _travel_client numeric, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  o public.orders;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.order_in_scope(_order_id, 'update') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF o.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'Заказ закрыт' USING ERRCODE = '22023'; END IF;
  IF _arrival > o.date_from OR _departure < o.date_to THEN
    RAISE EXCEPTION 'Вахта должна охватывать все смены заказа: заезд не позже %, выезд не раньше %', to_char(o.date_from, 'DD.MM.YYYY'), to_char(o.date_to, 'DD.MM.YYYY') USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rotation_accruals WHERE order_id = _order_id) AND EXISTS (
       SELECT 1 FROM public.order_rotations r WHERE r.order_id = _order_id
         AND (r.per_diem_worker, r.per_diem_client, r.travel_worker, r.travel_client) IS DISTINCT FROM (_per_diem_worker, _per_diem_client, _travel_worker, _travel_client)) THEN
    RAISE EXCEPTION 'Суточные и проезд уже начислены: правила не меняются, оформите корректировку начислений' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.order_rotations (order_id, org_id, arrival_date, departure_date, housing_address, housing_beds, housing_cost_per_bed_day, meals, meals_cost_per_day,
                                      per_diem_worker, per_diem_client, travel_worker, travel_client, note)
  VALUES (_order_id, o.org_id, _arrival, _departure, nullif(btrim(_address), ''), coalesce(_beds, 0), coalesce(_bed_cost, 0), coalesce(_meals, false), coalesce(_meals_cost, 0),
          coalesce(_per_diem_worker, 0), coalesce(_per_diem_client, 0), coalesce(_travel_worker, 0), coalesce(_travel_client, 0), _note)
  ON CONFLICT (order_id) DO UPDATE SET arrival_date = EXCLUDED.arrival_date, departure_date = EXCLUDED.departure_date, housing_address = EXCLUDED.housing_address,
    housing_beds = EXCLUDED.housing_beds, housing_cost_per_bed_day = EXCLUDED.housing_cost_per_bed_day, meals = EXCLUDED.meals, meals_cost_per_day = EXCLUDED.meals_cost_per_day,
    per_diem_worker = EXCLUDED.per_diem_worker, per_diem_client = EXCLUDED.per_diem_client, travel_worker = EXCLUDED.travel_worker, travel_client = EXCLUDED.travel_client,
    note = EXCLUDED.note, updated_at = now();
  UPDATE public.orders SET kind = 'rotation' WHERE id = _order_id;
  PERFORM private.sync_rotation_members(_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_order_rotation(_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.order_in_scope(_order_id, 'update') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.rotation_accruals WHERE order_id = _order_id) THEN
    RAISE EXCEPTION 'По вахте уже есть начисления: снять признак нельзя' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.order_rotations WHERE order_id = _order_id;
  UPDATE public.orders SET kind = 'regular' WHERE id = _order_id;
END;
$$;

-- Даты конкретного человека (приехал позже или уехал раньше).
CREATE OR REPLACE FUNCTION public.set_rotation_member(_order_id uuid, _worker_id uuid, _arrival date, _departure date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r public.order_rotations;
BEGIN
  SELECT * INTO r FROM public.order_rotations WHERE order_id = _order_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.order_in_scope(_order_id, 'update') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF _arrival < r.arrival_date OR _departure > r.departure_date OR _departure < _arrival THEN
    RAISE EXCEPTION 'Даты человека должны лежать внутри вахты (% — %)', to_char(r.arrival_date, 'DD.MM'), to_char(r.departure_date, 'DD.MM') USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rotation_members WHERE order_id = _order_id AND worker_id = _worker_id) THEN
    RAISE EXCEPTION 'Исполнитель не в составе вахты: сначала назначьте его на смены' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rotation_accruals WHERE order_id = _order_id AND worker_id = _worker_id) THEN
    RAISE EXCEPTION 'Суточные уже начислены: даты не меняются' USING ERRCODE = '22023';
  END IF;
  UPDATE public.rotation_members SET arrival_date = _arrival, departure_date = _departure WHERE order_id = _order_id AND worker_id = _worker_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_rotation_member(_order_id uuid, _worker_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private.order_in_scope(_order_id, 'update') THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.rotation_accruals WHERE order_id = _order_id AND worker_id = _worker_id) THEN
    RAISE EXCEPTION 'Суточные уже начислены: убрать нельзя' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.rotation_members WHERE order_id = _order_id AND worker_id = _worker_id;
END;
$$;

-- ============================================================
-- 3. Начисления вахты (ВХ-3)
-- ============================================================
-- Суточные — за каждый календарный месяц пребывания, когда пребывание в нём закончилось (уехал или месяц прошёл); проезд — в день заезда.
-- Повторный запуск ничего не дублирует. Исполнитель без назначения на смены заказа или без налогового статуса пропускается.
CREATE OR REPLACE FUNCTION private.do_generate_rotation_accruals(_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r public.order_rotations;
  m record;
  mon record;
  asg record;
  w public.workers;
  days integer;
  last_day date;
  t record;
  amt_w numeric;
  amt_c numeric;
  acc_id uuid;
  n integer := 0;
BEGIN
  SELECT * INTO r FROM public.order_rotations WHERE order_id = _order_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  FOR m IN SELECT * FROM public.rotation_members WHERE order_id = _order_id LOOP
    SELECT a.id AS assignment_id, s.id AS shift_id, s.site_id, s.client_id INTO asg
    FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id
    WHERE s.order_id = _order_id AND a.worker_id = m.worker_id AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked') AND NOT a.is_reserve
    ORDER BY s.shift_date LIMIT 1;
    SELECT * INTO w FROM public.workers WHERE user_id = m.worker_id AND org_id = m.org_id;
    IF asg.assignment_id IS NULL OR w.tax_status IS NULL THEN CONTINUE; END IF;

    -- Проезд: в день заезда
    IF m.arrival_date <= current_date AND (r.travel_worker > 0 OR r.travel_client > 0)
       AND NOT EXISTS (SELECT 1 FROM public.rotation_accruals x WHERE x.order_id = _order_id AND x.worker_id = m.worker_id AND x.kind = 'travel') THEN
      SELECT c.o_taxes, c.o_fee INTO t FROM private.calc_amounts(m.org_id, w.tax_status, r.travel_worker, m.arrival_date) c;
      INSERT INTO public.accruals (org_id, assignment_id, shift_id, shift_date, site_id, client_id, worker_id, kind, unit, quantity, billable_quantity, payable_quantity,
                                   client_rate, worker_rate, amount_client, amount_worker, tax_status, taxes, payout_fee, visible_to_client, note, period_month, status)
      VALUES (m.org_id, asg.assignment_id, asg.shift_id, m.arrival_date, asg.site_id, asg.client_id, m.worker_id, 'travel', 'service', 1, 1, 1,
              r.travel_client, r.travel_worker, r.travel_client, r.travel_worker, w.tax_status, t.o_taxes, t.o_fee, r.travel_client > 0,
              'Вахта: компенсация проезда', date_trunc('month', m.arrival_date)::date, 'approved')
      RETURNING id INTO acc_id;
      INSERT INTO public.rotation_accruals (order_id, worker_id, kind, month, accrual_id) VALUES (_order_id, m.worker_id, 'travel', date_trunc('month', m.arrival_date)::date, acc_id);
      n := n + 1;
    END IF;

    -- Суточные: по месяцам пребывания
    IF r.per_diem_worker > 0 OR r.per_diem_client > 0 THEN
      FOR mon IN SELECT date_trunc('month', d)::date AS month FROM generate_series(m.arrival_date, m.departure_date, interval '1 day') d GROUP BY 1 ORDER BY 1 LOOP
        last_day := least(m.departure_date, (mon.month + interval '1 month - 1 day')::date);
        IF last_day > current_date THEN CONTINUE; END IF;
        IF EXISTS (SELECT 1 FROM public.rotation_accruals x WHERE x.order_id = _order_id AND x.worker_id = m.worker_id AND x.kind = 'per_diem' AND x.month = mon.month) THEN CONTINUE; END IF;
        days := last_day - greatest(m.arrival_date, mon.month) + 1;
        amt_w := round(r.per_diem_worker * days, 2);
        amt_c := round(r.per_diem_client * days, 2);
        SELECT c.o_taxes, c.o_fee INTO t FROM private.calc_amounts(m.org_id, w.tax_status, amt_w, last_day) c;
        INSERT INTO public.accruals (org_id, assignment_id, shift_id, shift_date, site_id, client_id, worker_id, kind, unit, quantity, billable_quantity, payable_quantity,
                                     client_rate, worker_rate, amount_client, amount_worker, tax_status, taxes, payout_fee, visible_to_client, note, period_month, status)
        VALUES (m.org_id, asg.assignment_id, asg.shift_id, last_day, asg.site_id, asg.client_id, m.worker_id, 'per_diem', 'service', days, days, days,
                r.per_diem_client, r.per_diem_worker, amt_c, amt_w, w.tax_status, t.o_taxes, t.o_fee, amt_c > 0,
                'Вахта: суточные, ' || days || ' дн.', mon.month, 'approved')
        RETURNING id INTO acc_id;
        INSERT INTO public.rotation_accruals (order_id, worker_id, kind, month, accrual_id) VALUES (_order_id, m.worker_id, 'per_diem', mon.month, acc_id);
        n := n + 1;
      END LOOP;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_rotation_accruals(_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  o public.orders;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF NOT FOUND OR auth.uid() IS NULL OR private.permission_scope(auth.uid(), o.org_id, 'accruals', 'create') <> 'all' THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  RETURN private.do_generate_rotation_accruals(_order_id);
END;
$$;

-- Раз в сутки: суточные закончившихся месяцев и проезд заехавших.
CREATE OR REPLACE FUNCTION private.generate_due_rotation_accruals()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  n integer := 0;
  r record;
BEGIN
  FOR r IN SELECT order_id FROM public.order_rotations WHERE arrival_date <= current_date LOOP
    n := n + private.do_generate_rotation_accruals(r.order_id);
  END LOOP;
  RETURN n;
END;
$$;

-- ============================================================
-- 4. Календарь вахт (ВХ-2)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rotation_calendar(_org_id uuid, _from date, _days integer DEFAULT 28)
RETURNS TABLE (order_id uuid, site_name text, client_name text, housing_address text, worker_id uuid, worker_name text, arrival_date date, departure_date date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'orders', 'view') = 'none' THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
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

-- Загрузка жилья по дням: мест, занято, свободно.
CREATE OR REPLACE FUNCTION public.rotation_housing_load(_org_id uuid, _from date, _days integer DEFAULT 28)
RETURNS TABLE (order_id uuid, housing_address text, site_name text, day date, beds integer, occupied integer, free integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR private.permission_scope(auth.uid(), _org_id, 'orders', 'view') = 'none' THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  IF _days < 1 OR _days > 120 THEN RAISE EXCEPTION 'Горизонт — от 1 до 120 дней' USING ERRCODE = '22023'; END IF;
  RETURN QUERY
  SELECT r.order_id, r.housing_address, st.name, d::date, r.housing_beds,
         (SELECT count(*)::integer FROM public.rotation_members m WHERE m.order_id = r.order_id AND d::date BETWEEN m.arrival_date AND m.departure_date),
         r.housing_beds - (SELECT count(*)::integer FROM public.rotation_members m WHERE m.order_id = r.order_id AND d::date BETWEEN m.arrival_date AND m.departure_date)
  FROM public.order_rotations r JOIN public.orders o ON o.id = r.order_id AND o.status <> 'cancelled' JOIN public.sites st ON st.id = o.site_id
  CROSS JOIN generate_series(_from, _from + _days - 1, interval '1 day') d
  WHERE r.org_id = _org_id AND r.arrival_date <= _from + _days - 1 AND r.departure_date >= _from AND r.housing_beds > 0 AND private.order_in_scope(r.order_id, 'view')
  ORDER BY st.name, r.order_id, d;
END;
$$;

-- ============================================================
-- 5. Затраты на проживание и питание — в БДР
-- ============================================================
CREATE OR REPLACE FUNCTION private.rotation_costs(_org_ids uuid[], _from date, _to date)
RETURNS TABLE (org_id uuid, month date, amount numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT m.org_id, date_trunc('month', d)::date, sum(r.housing_cost_per_bed_day + CASE WHEN r.meals THEN r.meals_cost_per_day ELSE 0 END)
  FROM public.rotation_members m
  JOIN public.order_rotations r ON r.order_id = m.order_id
  JOIN public.orders o ON o.id = m.order_id AND o.status <> 'cancelled'
  CROSS JOIN LATERAL generate_series(greatest(m.arrival_date, _from), least(m.departure_date, _to, current_date), interval '1 day') d
  WHERE m.org_id = ANY (_org_ids)
  GROUP BY 1, 2
$$;

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
  UNION ALL
  SELECT rc.org_id, rc.month, 'rotation_costs', rc.amount FROM private.rotation_costs(_org_ids, _from, _to) rc
$$;


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
    ('payout_fees', 'Комиссии выплат', 40), ('other_staff_costs', 'Прочие расходы на персонал', 50), ('rotation_costs', 'Проживание и питание вахт', 55), ('admin_costs', 'Управленческие расходы', 60))
  SELECT b.month, b.article, n.article_name, n.sort_order, b.plan, b.fact FROM base b JOIN names n ON n.article = b.article
  UNION ALL SELECT c.month, 'operating_profit', 'Операционная прибыль', 70, c.op_p, c.op_f FROM calc c
  UNION ALL SELECT c.month, 'usn_tax', 'Налог по УСН (оценка)', 80, c.tax_p, c.tax_f FROM calc c
  UNION ALL SELECT c.month, 'net_profit', 'Чистая прибыль', 90, c.op_p - c.tax_p, c.op_f - c.tax_f FROM calc c
  ORDER BY 1, 4;
END;
$$;

CREATE OR REPLACE FUNCTION private.build_client_documents(_client_id uuid, _from date, _to date, _contract_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  c public.clients;
  org public.organizations;
  k public.contracts;
  act_id uuid;
  inv_id uuid;
  act_kind text;
  net numeric(14,2);
  vat numeric(14,2);
  linked integer;
  open_ts boolean;
  old record;
BEGIN
  SELECT * INTO c FROM public.clients WHERE id = _client_id;
  SELECT * INTO org FROM public.organizations WHERE id = c.org_id;
  IF _contract_id IS NOT NULL THEN
    SELECT * INTO k FROM public.contracts WHERE id = _contract_id AND client_id = _client_id;
  ELSE
    SELECT * INTO k FROM public.contracts WHERE client_id = _client_id AND status = 'active'
     AND signed_on <= _to AND (valid_until IS NULL OR valid_until >= _from) ORDER BY signed_on DESC LIMIT 1;
  END IF;
  IF k.id IS NULL THEN
    RAISE EXCEPTION 'У заказчика нет действующего договора на этот период' USING ERRCODE = '22023';
  END IF;
  act_kind := org.document_form;

  -- Прежний черновик за период снимается вместе со ссылками на начисления.
  FOR old IN SELECT id FROM public.client_documents
             WHERE client_id = _client_id AND status = 'draft' AND kind IN ('act', 'upd', 'invoice') AND period_from = _from AND period_to = _to LOOP
    UPDATE public.accruals SET client_document_id = NULL WHERE client_document_id = old.id;
  END LOOP;
  DELETE FROM public.client_documents WHERE client_id = _client_id AND status = 'draft' AND kind = 'invoice' AND period_from = _from AND period_to = _to;
  DELETE FROM public.client_documents WHERE client_id = _client_id AND status = 'draft' AND kind IN ('act', 'upd') AND period_from = _from AND period_to = _to;

  INSERT INTO public.client_documents (org_id, kind, client_id, contract_id, period_from, period_to, vat_rate)
  VALUES (c.org_id, act_kind, _client_id, k.id, _from, _to, org.vat_rate) RETURNING id INTO act_id;

  -- В документ входят утверждённые начисления заказчика, ещё не попавшие в другой документ: за период, а также
  -- доначисления за прошлые периоды и корректировки, подтверждённые позже.
  UPDATE public.accruals SET client_document_id = act_id
   WHERE client_id = _client_id AND org_id = c.org_id AND status IN ('approved', 'in_registry', 'paid') AND client_document_id IS NULL
     AND amount_client <> 0 AND shift_date <= _to;
  GET DIAGNOSTICS linked = ROW_COUNT;
  IF linked = 0 THEN
    DELETE FROM public.client_documents WHERE id = act_id;
    RETURN NULL;
  END IF;

  INSERT INTO public.client_document_lines (document_id, org_id, line_kind, site_name, position_name, unit, quantity, rate, amount, note, sort_order)
  SELECT act_id, c.org_id, g.line_kind, g.site_name, g.position_name, g.unit, g.quantity, g.rate, g.amount, g.note,
         row_number() OVER (ORDER BY g.ord, g.site_name, g.position_name, g.note, g.rate)
  FROM (
    SELECT e.line_kind, e.ord, e.site_name, e.position_name, e.unit, sum(e.qty) AS quantity, e.rate, sum(e.amount_client) AS amount,
           CASE e.line_kind WHEN 'penalty' THEN 'Оплата поздней отмены'
                            WHEN 'late' THEN 'За ' || to_char(to_date(min(e.month_key), 'YYYY-MM'), 'MM.YYYY') || ' (подтверждено позже)'
                            WHEN 'rotation' THEN min(e.rotation_note) END AS note
    FROM (
      SELECT CASE WHEN x.kind = 'client_penalty' THEN 'penalty' WHEN x.kind IN ('per_diem', 'travel') THEN 'rotation' WHEN x.shift_date < _from THEN 'late' ELSE 'work' END AS line_kind,
             CASE WHEN x.kind = 'client_penalty' THEN 3 WHEN x.kind IN ('per_diem', 'travel') THEN 5 WHEN x.shift_date < _from THEN 2 ELSE 1 END AS ord,
             si.name AS site_name, p.name AS position_name, x.unit,
             coalesce(x.billable_quantity, 1) AS qty, coalesce(x.client_rate, 0) AS rate, x.amount_client,
             CASE WHEN x.shift_date < _from AND x.kind NOT IN ('per_diem', 'travel') THEN to_char(x.shift_date, 'YYYY-MM') END AS month_key,
             CASE WHEN x.kind IN ('per_diem', 'travel') THEN x.note END AS rotation_note
      FROM public.accruals x
      JOIN public.sites si ON si.id = x.site_id
      JOIN public.shifts sh ON sh.id = x.shift_id
      JOIN public.positions p ON p.id = sh.position_id
      WHERE x.client_document_id = act_id AND x.kind IN ('main', 'client_penalty', 'per_diem', 'travel')
    ) e
    GROUP BY e.line_kind, e.ord, e.site_name, e.position_name, e.unit, e.rate, e.month_key, e.rotation_note
    UNION ALL
    -- Корректировки идут отдельными строками со ссылкой на исходный период (Б-5)
    SELECT 'correction', 4, si.name, p.name, 'service', 1, x.amount_client, x.amount_client,
           'Корректировка за ' || to_char(o.shift_date, 'MM.YYYY') || coalesce(': ' || x.note, '')
    FROM public.accruals x
    JOIN public.accruals o ON o.id = x.corrects_id
    JOIN public.sites si ON si.id = x.site_id
    JOIN public.shifts sh ON sh.id = x.shift_id
    JOIN public.positions p ON p.id = sh.position_id
    WHERE x.client_document_id = act_id AND x.kind = 'correction'
  ) g;

  SELECT coalesce(sum(amount), 0) INTO net FROM public.client_document_lines WHERE document_id = act_id;
  IF net <> (SELECT coalesce(sum(amount_client), 0) FROM public.accruals WHERE client_document_id = act_id) THEN
    RAISE EXCEPTION 'Сумма документа не сошлась с начислениями' USING ERRCODE = 'XX001';
  END IF;
  vat := round(net * org.vat_rate / 100, 2);

  SELECT EXISTS (SELECT 1 FROM public.timesheets t WHERE t.client_id = _client_id AND t.period_from <= _to AND t.period_to >= _from
                 AND t.status IN ('draft', 'pending', 'disputed')) INTO open_ts;

  UPDATE public.client_documents SET amount_net = net, vat_amount = vat, amount_total = net + vat, has_open_timesheets = open_ts WHERE id = act_id;

  -- Счёт с теми же строками и суммой
  INSERT INTO public.client_documents (org_id, kind, client_id, contract_id, parent_document_id, period_from, period_to,
                                       amount_net, vat_rate, vat_amount, amount_total, has_open_timesheets)
  VALUES (c.org_id, 'invoice', _client_id, k.id, act_id, _from, _to, net, org.vat_rate, vat, net + vat, open_ts) RETURNING id INTO inv_id;
  INSERT INTO public.client_document_lines (document_id, org_id, line_kind, site_name, position_name, unit, quantity, rate, amount, note, sort_order)
  SELECT inv_id, org_id, line_kind, site_name, position_name, unit, quantity, rate, amount, note, sort_order
  FROM public.client_document_lines WHERE document_id = act_id;
  RETURN act_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_order_rotation(uuid, date, date, text, integer, numeric, boolean, numeric, numeric, numeric, numeric, numeric, text), public.remove_order_rotation(uuid),
  public.set_rotation_member(uuid, uuid, date, date), public.remove_rotation_member(uuid, uuid), public.generate_rotation_accruals(uuid),
  public.rotation_calendar(uuid, date, integer), public.rotation_housing_load(uuid, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_order_rotation(uuid, date, date, text, integer, numeric, boolean, numeric, numeric, numeric, numeric, numeric, text), public.remove_order_rotation(uuid),
  public.set_rotation_member(uuid, uuid, date, date), public.remove_rotation_member(uuid, uuid), public.generate_rotation_accruals(uuid),
  public.rotation_calendar(uuid, date, integer), public.rotation_housing_load(uuid, date, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.sync_rotation_members(uuid), private.rotation_member_on_assignment(), private.do_generate_rotation_accruals(uuid),
  private.generate_due_rotation_accruals(), private.rotation_costs(uuid[], date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.sync_rotation_members(uuid), private.do_generate_rotation_accruals(uuid), private.generate_due_rotation_accruals(), private.rotation_costs(uuid[], date, date) TO service_role;
