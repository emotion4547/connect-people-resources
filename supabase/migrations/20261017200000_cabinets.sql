-- Этап 1, шаг 11: кабинеты заказчика и исполнителя.
-- ТЗ: раздел 12 (К-1…К-7, И-1…И-6).
--
-- Принцип: заказчик не видит паспортные данные, телефоны и ставки исполнителей; исполнитель не видит ставку
-- заказчику. Поэтому таблицы с деньгами (tariffs, shift_rates, accruals, assignments) кабинетам закрыты, а нужные
-- данные отдают функции ниже, и каждая сама проверяет, чей вызывающий и какие поля ему положены.

-- ============================================================
-- 1. Вспомогательное
-- ============================================================
CREATE OR REPLACE FUNCTION private.my_client_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT coalesce(array_agg(DISTINCT cc.client_id), '{}'::uuid[])
  FROM public.client_contacts cc
  WHERE cc.user_id = auth.uid() AND private.is_user_active(auth.uid())
$$;

-- Условные оплачиваемые часы смены с учётом доли ночных и праздничных часов.
-- _for_worker: учитывать ли минимум часов исполнителю (по галочке тарифа); заказчику минимум применяется всегда.
CREATE OR REPLACE FUNCTION private.shift_weighted_hours(_shift_id uuid, _for_worker boolean)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT CASE WHEN r.unit <> 'hour' THEN 1 ELSE
    greatest(
      hh.h * (1 + (r.night_coef - 1) * sm.night::numeric / nullif(sm.total, 0)
                + (r.holiday_coef - 1) * sm.holiday::numeric / nullif(sm.total, 0)),
      CASE WHEN _for_worker AND NOT r.min_paid_hours_for_worker THEN 0 ELSE r.min_paid_hours END)
  END
  FROM public.shifts s
  JOIN public.sites si ON si.id = s.site_id
  JOIN public.shift_rates r ON r.shift_id = s.id
  CROSS JOIN LATERAL private.split_minutes(s.start_at, s.end_at, si.timezone, s.org_id) sm
  CROSS JOIN LATERAL (SELECT extract(epoch FROM (s.end_at - s.start_at)) / 3600.0 - s.break_minutes / 60.0 AS h) hh
  WHERE s.id = _shift_id
$$;

REVOKE EXECUTE ON FUNCTION private.my_client_ids(), private.shift_weighted_hours(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.my_client_ids(), private.shift_weighted_hours(uuid, boolean) TO service_role;

-- Причина для штрафа заказчику за позднюю отмену.
CREATE OR REPLACE FUNCTION private.seed_accrual_reasons(_org_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$
  INSERT INTO public.directories (org_id, kind, name, sort_order) VALUES
    (_org_id, 'bonus_reason', 'Премия за качество работы', 1),
    (_org_id, 'bonus_reason', 'Срочный выход', 2),
    (_org_id, 'bonus_reason', 'Работа сверх плана', 3),
    (_org_id, 'deduction_reason', 'Порча имущества', 1),
    (_org_id, 'deduction_reason', 'Недостача', 2),
    (_org_id, 'deduction_reason', 'Нарушение требований объекта', 3),
    (_org_id, 'deduction_reason', 'Опоздание', 4),
    (_org_id, 'deduction_reason', 'Поздняя отмена заказчиком', 5)
  ON CONFLICT DO NOTHING
$$;
SELECT private.seed_accrual_reasons(id) FROM public.organizations;

-- ============================================================
-- 2. Кабинет заказчика
-- ============================================================
-- К-2: объект и позиция выбираются из тарифов заказчика, ставка заказчику видна, ставки исполнителя — нет.
CREATE OR REPLACE FUNCTION public.client_tariffs()
RETURNS TABLE (client_id uuid, site_id uuid, site_name text, position_id uuid, position_name text, unit text,
               client_rate numeric, night_coef numeric, holiday_coef numeric, min_paid_hours numeric, valid_from date, valid_to date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT t.client_id, t.site_id, si.name, t.position_id, p.name, t.unit, t.client_rate, t.night_coef, t.holiday_coef,
         t.min_paid_hours, t.valid_from, t.valid_to
  FROM public.tariffs t
  JOIN public.positions p ON p.id = t.position_id
  LEFT JOIN public.sites si ON si.id = t.site_id
  WHERE t.client_id = ANY (private.my_client_ids()) AND t.status = 'approved'
    AND (t.valid_to IS NULL OR t.valid_to >= current_date)
  ORDER BY si.name NULLS FIRST, p.name
$$;

-- К-1, К-3: смены заказчика с укомплектованностью. «Подтвердили» — подтвердили выход и позже, «на месте» — отметились.
CREATE OR REPLACE FUNCTION public.client_shifts(_from date, _to date)
RETURNS TABLE (shift_id uuid, order_id uuid, client_id uuid, site_id uuid, site_name text, position_name text, shift_date date,
               start_at timestamptz, end_at timestamptz, timezone text, status text, headcount integer,
               assigned_count integer, confirmed_count integer, on_site_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT s.id, s.order_id, s.client_id, s.site_id, si.name, p.name, s.shift_date, s.start_at, s.end_at, si.timezone, s.status, s.headcount,
         (count(a.id) FILTER (WHERE a.status IN ('assigned', 'confirmed', 'on_site', 'worked')))::integer,
         (count(a.id) FILTER (WHERE a.status IN ('confirmed', 'on_site', 'worked')))::integer,
         (count(a.id) FILTER (WHERE a.status IN ('on_site', 'worked')))::integer
  FROM public.shifts s
  JOIN public.sites si ON si.id = s.site_id
  JOIN public.positions p ON p.id = s.position_id
  LEFT JOIN public.assignments a ON a.shift_id = s.id AND NOT a.is_reserve
  WHERE s.client_id = ANY (private.my_client_ids()) AND s.shift_date BETWEEN _from AND _to
  GROUP BY s.id, si.name, si.timezone, p.name
  ORDER BY s.shift_date, s.start_at, si.name
$$;

-- Люди на смене: имя, рейтинг, отметка прихода. Телефона, документов и ставок здесь нет.
CREATE OR REPLACE FUNCTION public.client_shift_people(_shift_id uuid)
RETURNS TABLE (assignment_id uuid, worker_name text, rating numeric, status text, check_in_at timestamptz, late_minutes integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.shifts s WHERE s.id = _shift_id AND s.client_id = ANY (private.my_client_ids())) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.id, w.full_name, w.rating, a.status, a.check_in_at, a.late_minutes
  FROM public.assignments a
  JOIN public.workers w ON w.user_id = a.worker_id
  WHERE a.shift_id = _shift_id AND NOT a.is_reserve AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked', 'no_show')
  ORDER BY w.full_name;
END;
$$;

-- Штраф заказчику за позднюю отмену: доля оплаты по договору (настройки заказчика). Если оплачиваемой отмены
-- нет (значения не заданы), штрафа нет.
CREATE OR REPLACE FUNCTION private.client_cancel_penalty(_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.assignments;
  s public.shifts;
  free_hours numeric;
  pct numeric;
  reason uuid;
  w public.workers;
  r public.shift_rates;
BEGIN
  SELECT * INTO a FROM public.assignments WHERE id = _assignment_id;
  SELECT * INTO s FROM public.shifts WHERE id = a.shift_id;
  free_hours := public.get_setting_numeric(a.org_id, 'cancel.client_free_hours', s.shift_date, s.client_id, s.site_id);
  pct := public.get_setting_numeric(a.org_id, 'cancel.client_paid_pct', s.shift_date, s.client_id, s.site_id);
  IF free_hours IS NULL OR pct IS NULL OR s.start_at - now() >= make_interval(secs => free_hours * 3600) THEN RETURN; END IF;
  SELECT * INTO r FROM public.shift_rates WHERE shift_id = s.id;
  SELECT * INTO w FROM public.workers WHERE user_id = a.worker_id;
  SELECT d.id INTO reason FROM public.directories d
   WHERE d.org_id = a.org_id AND d.kind = 'deduction_reason' AND d.name = 'Поздняя отмена заказчиком' AND d.is_active LIMIT 1;
  IF r.shift_id IS NULL OR reason IS NULL THEN RETURN; END IF;
  INSERT INTO public.accruals (org_id, assignment_id, shift_id, shift_date, site_id, client_id, worker_id, kind, amount_client,
                               tax_status, visible_to_client, reason_id, note, period_month, status)
  VALUES (a.org_id, a.id, s.id, s.shift_date, s.site_id, s.client_id, a.worker_id, 'client_penalty',
          round(private.shift_weighted_hours(s.id, false) * r.client_rate * pct / 100, 2),
          coalesce(w.tax_status, 'self_employed'), true, reason,
          'Отмена менее чем за ' || free_hours || ' ч до начала', date_trunc('month', s.shift_date)::date, 'approved');
END;
$$;

-- К-3: заказчик отменяет смену. Позднюю отмену считает договор (штраф начисляется автоматически).
CREATE OR REPLACE FUNCTION public.client_cancel_shift(_shift_id uuid, _reason_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  s public.shifts;
  a record;
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id FOR UPDATE;
  IF NOT FOUND OR s.client_id <> ALL (private.my_client_ids()) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF s.status NOT IN ('open', 'staffed') OR s.start_at <= now() THEN
    RAISE EXCEPTION 'Эту смену уже нельзя отменить' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.directories d WHERE d.id = _reason_id AND d.kind = 'cancel_reason' AND d.org_id = s.org_id AND d.is_active) THEN
    RAISE EXCEPTION 'Выберите причину отмены' USING ERRCODE = '22023';
  END IF;
  FOR a IN SELECT id FROM public.assignments WHERE shift_id = _shift_id AND NOT is_reserve AND status IN ('assigned', 'confirmed') LOOP
    PERFORM private.client_cancel_penalty(a.id);
  END LOOP;
  UPDATE public.assignments SET status = 'cancelled_manager', reason_id = _reason_id
   WHERE shift_id = _shift_id AND status IN ('assigned', 'confirmed', 'responded', 'invited');
  UPDATE public.shifts SET status = 'cancelled', cancel_reason_id = _reason_id WHERE id = _shift_id;
END;
$$;

-- К-3: заказчик уменьшает число людей на смене. Лишние (назначенные последними) снимаются.
CREATE OR REPLACE FUNCTION public.client_reduce_shift(_shift_id uuid, _headcount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  s public.shifts;
  a record;
  removed integer := 0;
  excess integer;
BEGIN
  SELECT * INTO s FROM public.shifts WHERE id = _shift_id FOR UPDATE;
  IF NOT FOUND OR s.client_id <> ALL (private.my_client_ids()) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF s.status NOT IN ('open', 'staffed') OR s.start_at <= now() THEN
    RAISE EXCEPTION 'Эту смену уже нельзя изменить' USING ERRCODE = '22023';
  END IF;
  IF _headcount IS NULL OR _headcount < 1 OR _headcount >= s.headcount THEN
    RAISE EXCEPTION 'Новое число людей должно быть меньше текущего (%) и не меньше одного', s.headcount USING ERRCODE = '22023';
  END IF;
  SELECT count(*) - _headcount INTO excess FROM public.assignments
   WHERE shift_id = _shift_id AND NOT is_reserve AND status IN ('assigned', 'confirmed');
  FOR a IN
    SELECT id FROM public.assignments WHERE shift_id = _shift_id AND NOT is_reserve AND status IN ('assigned', 'confirmed')
    ORDER BY created_at DESC LIMIT greatest(excess, 0)
  LOOP
    PERFORM private.client_cancel_penalty(a.id);
    UPDATE public.assignments SET status = 'cancelled_manager' WHERE id = a.id;
    removed := removed + 1;
  END LOOP;
  UPDATE public.shifts SET headcount = _headcount WHERE id = _shift_id;
  RETURN removed;
END;
$$;

-- К-4: суммы по табелю для заказчика — только начисления с пометкой «видно заказчику» и только его сторона.
CREATE OR REPLACE FUNCTION public.client_accruals(_from date, _to date)
RETURNS TABLE (accrual_id uuid, shift_date date, site_name text, worker_name text, kind text, quantity numeric, client_rate numeric,
               amount_client numeric, reason text, note text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT x.id, x.shift_date, si.name, w.full_name, x.kind, x.quantity, x.client_rate, x.amount_client, d.name, x.note
  FROM public.accruals x
  JOIN public.sites si ON si.id = x.site_id
  JOIN public.workers w ON w.user_id = x.worker_id
  LEFT JOIN public.directories d ON d.id = x.reason_id
  WHERE x.client_id = ANY (private.my_client_ids()) AND x.visible_to_client AND x.status <> 'draft'
    AND x.shift_date BETWEEN _from AND _to
  ORDER BY x.shift_date, w.full_name, x.kind
$$;

-- ============================================================
-- 3. Кабинет исполнителя
-- ============================================================
-- И-1, И-3: мои смены. Своя ставка и ориентировочный заработок видны, ставки заказчику — нет.
CREATE OR REPLACE FUNCTION public.worker_my_shifts(_from date, _to date)
RETURNS TABLE (assignment_id uuid, shift_id uuid, status text, is_reserve boolean, shift_date date, start_at timestamptz, end_at timestamptz,
               timezone text, site_name text, address text, latitude numeric, longitude numeric, instructions text, contact_name text,
               position_name text, worker_rate numeric, planned_hours numeric, est_earnings numeric, check_in_at timestamptz,
               check_out_at timestamptz, checkin_method text, approved_hours numeric, can_check_in boolean, can_cancel_free boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT a.id, s.id, a.status, a.is_reserve, s.shift_date, s.start_at, s.end_at, si.timezone, si.name, si.address, si.latitude, si.longitude,
         si.instructions, si.contact_name, p.name, r.worker_rate,
         round(extract(epoch FROM (s.end_at - s.start_at)) / 3600.0 - s.break_minutes / 60.0, 2),
         round(r.worker_rate * private.shift_weighted_hours(s.id, true), 2),
         a.check_in_at, a.check_out_at, si.checkin_method, a.approved_hours,
         (a.status IN ('assigned', 'confirmed') AND a.check_in_at IS NULL AND now() >= s.start_at - interval '30 minutes' AND now() <= s.end_at),
         (s.start_at - now() >= make_interval(secs => coalesce(public.get_setting_numeric(a.org_id, 'cancel.worker_free_hours', s.shift_date, s.client_id, s.site_id), 12) * 3600))
  FROM public.assignments a
  JOIN public.shifts s ON s.id = a.shift_id
  JOIN public.sites si ON si.id = s.site_id
  JOIN public.positions p ON p.id = s.position_id
  LEFT JOIN public.shift_rates r ON r.shift_id = s.id
  WHERE a.worker_id = auth.uid() AND s.shift_date BETWEEN _from AND _to
    AND a.status NOT IN ('rejected', 'cancelled_worker', 'cancelled_manager', 'removed_by_client')
  ORDER BY s.start_at
$$;

-- И-2: открытые смены по своим позициям; ставка исполнителю и ориентировочный заработок.
CREATE OR REPLACE FUNCTION public.worker_open_shifts(_from date, _to date)
RETURNS TABLE (shift_id uuid, shift_date date, start_at timestamptz, end_at timestamptz, timezone text, site_name text, address text,
               position_id uuid, position_name text, worker_rate numeric, est_earnings numeric, free_places integer, overlaps boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT s.id, s.shift_date, s.start_at, s.end_at, si.timezone, si.name, si.address, s.position_id, p.name, r.worker_rate,
         round(r.worker_rate * private.shift_weighted_hours(s.id, true), 2),
         greatest(s.headcount - (SELECT count(*) FROM public.assignments x
                                 WHERE x.shift_id = s.id AND NOT x.is_reserve AND x.status IN ('assigned', 'confirmed', 'on_site', 'worked')), 0)::integer,
         EXISTS (SELECT 1 FROM public.assignments x
                 WHERE x.worker_id = auth.uid() AND x.status IN ('assigned', 'confirmed', 'on_site', 'worked')
                   AND tstzrange(x.shift_start, x.shift_end, '[)') && tstzrange(s.start_at, s.end_at, '[)'))
  FROM public.shifts s
  JOIN public.workers w ON w.user_id = auth.uid() AND w.org_id = s.org_id AND w.status = 'active'
  JOIN public.sites si ON si.id = s.site_id AND si.status = 'active'
  JOIN public.positions p ON p.id = s.position_id
  JOIN public.worker_positions wp ON wp.worker_id = auth.uid() AND wp.position_id = s.position_id
  LEFT JOIN public.shift_rates r ON r.shift_id = s.id
  WHERE s.published_at IS NOT NULL AND s.status IN ('open', 'staffed') AND s.start_at > now() AND s.shift_date BETWEEN _from AND _to
    AND NOT EXISTS (SELECT 1 FROM public.assignments x WHERE x.shift_id = s.id AND x.worker_id = auth.uid())
  ORDER BY s.start_at
$$;

-- И-4: заработок по сменам. Бонусы и удержания идут отдельными строками с причиной.
CREATE OR REPLACE FUNCTION public.worker_earnings(_from date, _to date)
RETURNS TABLE (accrual_id uuid, shift_date date, site_name text, kind text, hours numeric, amount numeric, reason text, note text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT x.id, x.shift_date, si.name, x.kind, x.quantity, x.amount_worker, d.name, x.note
  FROM public.accruals x
  JOIN public.sites si ON si.id = x.site_id
  LEFT JOIN public.directories d ON d.id = x.reason_id
  WHERE x.worker_id = auth.uid() AND x.status <> 'draft' AND x.kind <> 'client_penalty' AND x.shift_date BETWEEN _from AND _to
  ORDER BY x.shift_date DESC, x.kind
$$;

-- Приглашение менеджера (например, из «повторить неделю») исполнитель принимает или отклоняет сам.
CREATE OR REPLACE FUNCTION public.accept_invitation(_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.assignments;
BEGIN
  SELECT * INTO a FROM public.assignments WHERE id = _assignment_id AND worker_id = auth.uid() AND status = 'invited' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Приглашение не найдено' USING ERRCODE = '22023';
  END IF;
  PERFORM private.do_assign(a.shift_id, a.worker_id, true, a.source);
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_invitation(_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  UPDATE public.assignments SET status = 'rejected' WHERE id = _assignment_id AND worker_id = auth.uid() AND status = 'invited';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Приглашение не найдено' USING ERRCODE = '22023';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.client_tariffs(), public.client_shifts(date, date), public.client_shift_people(uuid),
  public.client_cancel_shift(uuid, uuid), public.client_reduce_shift(uuid, integer), public.client_accruals(date, date),
  public.worker_my_shifts(date, date), public.worker_open_shifts(date, date), public.worker_earnings(date, date),
  public.accept_invitation(uuid), public.decline_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_tariffs(), public.client_shifts(date, date), public.client_shift_people(uuid),
  public.client_cancel_shift(uuid, uuid), public.client_reduce_shift(uuid, integer), public.client_accruals(date, date),
  public.worker_my_shifts(date, date), public.worker_open_shifts(date, date), public.worker_earnings(date, date),
  public.accept_invitation(uuid), public.decline_invitation(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.client_cancel_penalty(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.client_cancel_penalty(uuid) TO service_role;
