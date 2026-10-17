-- Этап 1, шаг 9: отметки на объекте, расчёт часов, табель, оценки и рейтинг.
-- ТЗ: раздел 9 (Т-1…Т-17).
--
-- Табель — единственный источник часов для актов и выплат. Строки табеля — это назначения периода:
-- у каждого есть приход, уход, часы и статус подтверждения заказчиком. Подтверждённая строка
-- блокируется; начисление по ней создаёт шаг 10 (здесь оставлена точка подключения).
--
-- Не входит: напоминания и уведомления (шаг 12), экран исполнителя с кнопкой «Я на месте» и экран
-- заказчика с подтверждением (шаг 11) — база для них готова.

-- ============================================================
-- 1. Столбцы
-- ============================================================
ALTER TABLE public.sites
  -- По графику: пришёл вовремя — оплачивается плановое время. По факту: уход − приход − перерыв.
  ADD COLUMN hours_mode text NOT NULL DEFAULT 'schedule' CHECK (hours_mode IN ('schedule', 'actual'));

ALTER TABLE public.workers ADD COLUMN is_brigadier boolean NOT NULL DEFAULT false;

ALTER TABLE public.assignments
  ADD COLUMN check_in_manual_reason text,
  ADD COLUMN check_out_manual_reason text,
  ADD COLUMN check_out_auto boolean NOT NULL DEFAULT false,
  ADD COLUMN late_minutes integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  ADD COLUMN night_hours numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN holiday_hours numeric(6,2) NOT NULL DEFAULT 0,
  -- Переработка сверх плана: возможная и утверждённая менеджером. В часы она входит только утверждённой частью.
  ADD COLUMN overtime_hours numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN overtime_approved_hours numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN client_comment text,
  ADD COLUMN manager_comment text,
  ADD COLUMN timesheet_id uuid,
  ADD COLUMN line_status text CHECK (line_status IN ('pending', 'confirmed', 'disputed'));

CREATE INDEX assignments_timesheet_idx ON public.assignments (timesheet_id) WHERE timesheet_id IS NOT NULL;

-- ============================================================
-- 2. Табель и споры
-- ============================================================
CREATE TABLE public.timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid NOT NULL,
  client_id uuid NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  -- Черновик → На подтверждении → Подтверждён (вручную или автоматически) или Есть споры → Закрыт (вошёл в акт).
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'confirmed', 'disputed', 'closed')),
  sent_at timestamptz,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirm_deadline timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_auto boolean NOT NULL DEFAULT false,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, site_id) REFERENCES public.sites (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE RESTRICT,
  UNIQUE (org_id, id),
  UNIQUE (site_id, period_from, period_to),
  CONSTRAINT timesheets_period_ordered CHECK (period_to >= period_from)
);

ALTER TABLE public.assignments
  ADD CONSTRAINT assignments_timesheet_fkey FOREIGN KEY (timesheet_id) REFERENCES public.timesheets(id) ON DELETE SET NULL;

CREATE INDEX timesheets_org_status_idx ON public.timesheets (org_id, status, confirm_deadline);

CREATE TRIGGER update_timesheets_updated_at
  BEFORE UPDATE ON public.timesheets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_timesheets
  AFTER INSERT OR UPDATE OR DELETE ON public.timesheets
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('site_id', 'period_from', 'period_to', 'status', 'confirmed_auto');

CREATE TABLE public.timesheet_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  timesheet_id uuid NOT NULL REFERENCES public.timesheets(id) ON DELETE CASCADE,
  assignment_id uuid NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  proposed_hours numeric(6,2) NOT NULL CHECK (proposed_hours >= 0),
  original_hours numeric(6,2),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'rejected')),
  resolution_comment text,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX timesheet_disputes_timesheet_idx ON public.timesheet_disputes (timesheet_id, status);

CREATE TRIGGER audit_timesheet_disputes
  AFTER INSERT OR UPDATE ON public.timesheet_disputes
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('timesheet_id', 'assignment_id', 'proposed_hours', 'original_hours', 'status');

-- Переписка по спорной строке хранится у строки.
CREATE TABLE public.timesheet_dispute_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES public.timesheet_disputes(id) ON DELETE CASCADE,
  author_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  author_side text NOT NULL CHECK (author_side IN ('client', 'manager')),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. Подсчёт часов
-- ============================================================
CREATE OR REPLACE FUNCTION private.distance_m(_lat1 numeric, _lon1 numeric, _lat2 numeric, _lon2 numeric)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians((_lat2 - _lat1)::double precision) / 2), 2)
    + cos(radians(_lat1::double precision)) * cos(radians(_lat2::double precision))
      * power(sin(radians((_lon2 - _lon1)::double precision) / 2), 2)))
$$;

-- Минуты смены: всего, ночных (22:00–06:00 по времени объекта) и праздничных (по справочнику).
CREATE OR REPLACE FUNCTION private.split_minutes(_start timestamptz, _end timestamptz, _tz text, _org_id uuid)
RETURNS TABLE (total integer, night integer, holiday integer)
LANGUAGE sql
STABLE
SET search_path = public, private
AS $$
  SELECT count(*)::integer,
         (count(*) FILTER (WHERE x.h >= 22 OR x.h < 6))::integer,
         (count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.directories d
                                         WHERE d.org_id = _org_id AND d.kind = 'holiday' AND d.is_active AND d.item_date = x.d)))::integer
  FROM (
    SELECT extract(hour FROM (m AT TIME ZONE _tz))::integer AS h, (m AT TIME ZONE _tz)::date AS d
    FROM generate_series(_start, _end - interval '1 minute', interval '1 minute') m
  ) x
$$;

-- Пересчёт часов назначения после прихода и ухода (Т-7…Т-9).
--   По графику: плановое время; опоздание сверх допуска вычитается в минутах.
--   По факту: уход − приход − перерыв с округлением из настроек; сверх плана — только как переработка,
--   которая входит в часы после утверждения менеджером.
--   Ночные и праздничные часы выделяются пропорционально от итоговых часов, чтобы применить коэффициенты тарифа.
CREATE OR REPLACE FUNCTION private.recalc_assignment_hours(_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.assignments;
  s public.shifts;
  site public.sites;
  tolerance numeric;
  round_min numeric;
  round_mode text;
  planned numeric;
  raw numeric;
  rounded numeric;
  eff numeric;
  over numeric := 0;
  late integer;
  tot integer; nit integer; hol integer;
BEGIN
  SELECT * INTO a FROM public.assignments WHERE id = _assignment_id;
  IF a.check_in_at IS NULL OR a.check_out_at IS NULL THEN RETURN; END IF;
  SELECT * INTO s FROM public.shifts WHERE id = a.shift_id;
  SELECT * INTO site FROM public.sites WHERE id = s.site_id;

  tolerance := coalesce(public.get_setting_numeric(a.org_id, 'checkin.late_tolerance_min', s.shift_date, s.client_id, s.site_id), 10);
  round_min := coalesce(public.get_setting_numeric(a.org_id, 'hours.rounding_minutes', s.shift_date, s.client_id, s.site_id), 15);
  round_mode := coalesce(public.get_setting(a.org_id, 'hours.rounding_mode', s.shift_date, s.client_id, s.site_id) #>> '{}', 'down');

  planned := extract(epoch FROM (s.end_at - s.start_at)) / 3600.0 - s.break_minutes / 60.0;
  late := greatest(0, floor(extract(epoch FROM (a.check_in_at - s.start_at)) / 60.0))::integer;

  IF site.hours_mode = 'schedule' THEN
    eff := planned - CASE WHEN late > tolerance THEN late / 60.0 ELSE 0 END;
    raw := extract(epoch FROM (a.check_out_at - a.check_in_at)) / 3600.0 - s.break_minutes / 60.0;
  ELSE
    raw := extract(epoch FROM (a.check_out_at - a.check_in_at)) / 3600.0 - s.break_minutes / 60.0;
    IF round_min > 0 THEN
      rounded := CASE round_mode
        WHEN 'up' THEN ceil(raw * 60 / round_min) * round_min / 60
        WHEN 'nearest' THEN round(raw * 60 / round_min) * round_min / 60
        ELSE floor(raw * 60 / round_min) * round_min / 60 END;
    ELSE
      rounded := raw;
    END IF;
    eff := least(rounded, planned);
    over := greatest(0, rounded - planned);
  END IF;
  eff := greatest(0, eff);

  SELECT m.total, m.night, m.holiday INTO tot, nit, hol FROM private.split_minutes(s.start_at, s.end_at, site.timezone, a.org_id) m;

  PERFORM set_config('app.timesheet_internal', 'on', true);
  UPDATE public.assignments SET
    planned_hours = round(planned, 2),
    actual_hours = round(greatest(0, raw), 2),
    late_minutes = late,
    overtime_hours = round(over, 2),
    approved_hours = round(eff + least(overtime_approved_hours, over), 2),
    night_hours = round((eff + least(overtime_approved_hours, over)) * nit / nullif(tot, 0), 2),
    holiday_hours = round((eff + least(overtime_approved_hours, over)) * hol / nullif(tot, 0), 2)
  WHERE id = _assignment_id;
  PERFORM set_config('app.timesheet_internal', 'off', true);
END;
$$;

-- Подтверждённая строка табеля не правится (Т-14): изменения только корректировкой (шаг 10).
CREATE OR REPLACE FUNCTION private.assignments_lock_confirmed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.timesheet_internal', true) = 'on' THEN RETURN NEW; END IF;
  IF OLD.line_status = 'confirmed' AND (
       NEW.status, NEW.check_in_at, NEW.check_out_at, NEW.planned_hours, NEW.actual_hours, NEW.approved_hours,
       NEW.night_hours, NEW.holiday_hours, NEW.overtime_hours, NEW.overtime_approved_hours, NEW.shift_id, NEW.worker_id, NEW.line_status)
     IS DISTINCT FROM (
       OLD.status, OLD.check_in_at, OLD.check_out_at, OLD.planned_hours, OLD.actual_hours, OLD.approved_hours,
       OLD.night_hours, OLD.holiday_hours, OLD.overtime_hours, OLD.overtime_approved_hours, OLD.shift_id, OLD.worker_id, OLD.line_status) THEN
    RAISE EXCEPTION 'Подтверждённая строка табеля не правится: оформите корректировку' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER assignments_lock_confirmed
  BEFORE UPDATE ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION private.assignments_lock_confirmed();

-- Точка подключения шага 10: здесь будет создаваться основное начисление по подтверждённой строке.
CREATE OR REPLACE FUNCTION private.create_accrual_for_assignment(_assignment_id uuid)
RETURNS void
LANGUAGE sql
AS $$ SELECT $$;

-- ============================================================
-- 4. Отметки на объекте (Т-2…Т-6)
-- ============================================================
-- Проверка отметки по способу объекта: QR, геолокация или оба. Время — серверное, не телефона.
CREATE OR REPLACE FUNCTION private.validate_checkpoint(_site public.sites, _lat numeric, _lon numeric, _qr text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, private
AS $$
DECLARE
  radius numeric;
  dist double precision;
BEGIN
  IF _site.checkin_method = 'manual' THEN
    RAISE EXCEPTION 'На этом объекте отметку ставит менеджер или бригадир' USING ERRCODE = '22023';
  END IF;

  IF _site.checkin_method IN ('qr', 'both') THEN
    IF _qr IS NULL OR private.verify_site_qr(_qr) IS DISTINCT FROM _site.id THEN
      RAISE EXCEPTION 'Код объекта не подошёл или устарел: отсканируйте код ещё раз' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF _site.checkin_method IN ('geo', 'both') THEN
    IF _lat IS NULL OR _lon IS NULL THEN
      RAISE EXCEPTION 'Не удалось определить ваше местоположение: разрешите доступ к геолокации' USING ERRCODE = '22023';
    END IF;
    IF _site.latitude IS NULL OR _site.longitude IS NULL THEN
      RAISE EXCEPTION 'У объекта не задана точка на карте: обратитесь к менеджеру' USING ERRCODE = '22023';
    END IF;
    radius := coalesce(_site.checkin_radius_m, public.get_setting_numeric(_site.org_id, 'checkin.geo_radius_m', current_date, NULL, _site.id), 200);
    dist := private.distance_m(_lat, _lon, _site.latitude, _site.longitude);
    IF dist > radius THEN
      RAISE EXCEPTION 'Вы в % м от объекта, а отметиться можно в радиусе % м', round(dist), radius USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN _site.checkin_method;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_in(_assignment_id uuid, _lat numeric DEFAULT NULL, _lon numeric DEFAULT NULL,
                                           _accuracy numeric DEFAULT NULL, _qr text DEFAULT NULL)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.assignments;
  s public.shifts;
  site public.sites;
  m text;
BEGIN
  SELECT * INTO a FROM public.assignments WHERE id = _assignment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR a.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF a.status NOT IN ('assigned', 'confirmed') OR a.check_in_at IS NOT NULL THEN
    RAISE EXCEPTION 'Отметиться на этой смене нельзя' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.shifts WHERE id = a.shift_id;
  SELECT * INTO site FROM public.sites WHERE id = s.site_id;
  IF now() < s.start_at - interval '30 minutes' THEN
    RAISE EXCEPTION 'Отметиться можно за 30 минут до начала смены' USING ERRCODE = '22023';
  END IF;
  IF now() > s.end_at THEN
    RAISE EXCEPTION 'Смена уже закончилась' USING ERRCODE = '22023';
  END IF;

  m := private.validate_checkpoint(site, _lat, _lon, _qr);
  UPDATE public.assignments
     SET check_in_at = now(), check_in_method = m, check_in_lat = _lat, check_in_lon = _lon, check_in_accuracy_m = _accuracy,
         status = 'on_site', late_minutes = greatest(0, floor(extract(epoch FROM (now() - s.start_at)) / 60.0))::integer
   WHERE id = _assignment_id;
  RETURN now();
END;
$$;

CREATE OR REPLACE FUNCTION public.check_out(_assignment_id uuid, _lat numeric DEFAULT NULL, _lon numeric DEFAULT NULL,
                                            _accuracy numeric DEFAULT NULL, _qr text DEFAULT NULL)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.assignments;
  s public.shifts;
  site public.sites;
  m text;
BEGIN
  SELECT * INTO a FROM public.assignments WHERE id = _assignment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR a.worker_id <> auth.uid() THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF a.status <> 'on_site' OR a.check_out_at IS NOT NULL THEN
    RAISE EXCEPTION 'Закончить смену можно только после отметки о приходе' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.shifts WHERE id = a.shift_id;
  SELECT * INTO site FROM public.sites WHERE id = s.site_id;

  m := private.validate_checkpoint(site, _lat, _lon, _qr);
  UPDATE public.assignments SET check_out_at = now(), check_out_method = m, status = 'worked' WHERE id = _assignment_id;
  PERFORM private.recalc_assignment_hours(_assignment_id);
  RETURN now();
END;
$$;

-- Ручная отметка менеджером или бригадиром (Т-3, Т-4): с причиной, видна в табеле и журнале.
CREATE OR REPLACE FUNCTION private.do_manual_check(_assignment_id uuid, _kind text, _at timestamptz, _reason text, _actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.assignments;
  s public.shifts;
BEGIN
  IF nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Укажите причину ручной отметки' USING ERRCODE = '22023';
  END IF;
  IF _kind NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'Неизвестный вид отметки' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM public.assignments WHERE id = _assignment_id FOR UPDATE;
  SELECT * INTO s FROM public.shifts WHERE id = a.shift_id;
  IF _at > now() THEN
    RAISE EXCEPTION 'Время отметки не может быть в будущем' USING ERRCODE = '22023';
  END IF;

  IF _kind = 'in' THEN
    IF a.status NOT IN ('assigned', 'confirmed', 'no_show') OR a.check_in_at IS NOT NULL THEN
      RAISE EXCEPTION 'Приход этому исполнителю отметить нельзя' USING ERRCODE = '22023';
    END IF;
    UPDATE public.assignments SET check_in_at = _at, check_in_method = 'manual', check_in_manual_reason = _reason,
           status = 'on_site', reason_id = NULL,
           late_minutes = greatest(0, floor(extract(epoch FROM (_at - s.start_at)) / 60.0))::integer
     WHERE id = _assignment_id;
  ELSE
    IF a.status <> 'on_site' OR a.check_in_at IS NULL OR _at < a.check_in_at THEN
      RAISE EXCEPTION 'Уход можно отметить после прихода' USING ERRCODE = '22023';
    END IF;
    UPDATE public.assignments SET check_out_at = _at, check_out_method = 'manual', check_out_manual_reason = _reason,
           check_out_auto = false, status = 'worked'
     WHERE id = _assignment_id;
    PERFORM private.recalc_assignment_hours(_assignment_id);
  END IF;

  INSERT INTO public.audit_log (org_id, actor_id, action, table_name, record_id, field, new_value, note)
  VALUES (a.org_id, _actor, 'update', 'assignments', _assignment_id::text, 'check_' || _kind, _at::text, 'ручная отметка: ' || _reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.manual_check(_assignment_id uuid, _kind text, _at timestamptz, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  _shift uuid;
BEGIN
  SELECT shift_id INTO _shift FROM public.assignments WHERE id = _assignment_id;
  IF _shift IS NULL OR auth.uid() IS NULL OR NOT private.shift_assign_in_scope(_shift, 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  PERFORM private.do_manual_check(_assignment_id, _kind, _at, _reason, auth.uid());
END;
$$;

-- Бригадир отмечает свою группу списком (Т-4): только на смене, где он сам назначен.
CREATE OR REPLACE FUNCTION public.brigade_check(_shift_id uuid, _assignment_ids uuid[], _kind text, _reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  aid uuid;
  n integer := 0;
BEGIN
  IF auth.uid() IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.workers w WHERE w.user_id = auth.uid() AND w.is_brigadier AND w.status = 'active')
     OR NOT EXISTS (SELECT 1 FROM public.assignments a WHERE a.shift_id = _shift_id AND a.worker_id = auth.uid()
                    AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked')) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  FOREACH aid IN ARRAY _assignment_ids LOOP
    IF EXISTS (SELECT 1 FROM public.assignments a WHERE a.id = aid AND a.shift_id = _shift_id) THEN
      PERFORM private.do_manual_check(aid, _kind, now(), 'Бригадир: ' || coalesce(_reason, ''), auth.uid());
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- Утверждение переработки менеджером (Т-8).
CREATE OR REPLACE FUNCTION public.approve_overtime(_assignment_id uuid, _hours numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.assignments;
BEGIN
  SELECT * INTO a FROM public.assignments WHERE id = _assignment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.shift_assign_in_scope(a.shift_id, 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF a.line_status = 'confirmed' THEN
    RAISE EXCEPTION 'Строка табеля уже подтверждена' USING ERRCODE = '22023';
  END IF;
  IF _hours < 0 OR _hours > a.overtime_hours THEN
    RAISE EXCEPTION 'Утвердить можно от 0 до % ч переработки', a.overtime_hours USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.timesheet_internal', 'on', true);
  UPDATE public.assignments SET overtime_approved_hours = _hours WHERE id = _assignment_id;
  PERFORM set_config('app.timesheet_internal', 'off', true);
  PERFORM private.recalc_assignment_hours(_assignment_id);
END;
$$;

-- Что делает расписание: приход не отмечен 2 часа — «Не вышел»; уход не отмечен 2 часа после конца —
-- уход по графику с пометкой «авто» (Т-5, Т-6). Вызывается по расписанию.
CREATE OR REPLACE FUNCTION private.process_attendance()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  n integer := 0;
  m integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT a.id FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id
    WHERE a.status = 'on_site' AND a.check_out_at IS NULL AND s.end_at + interval '2 hours' < now()
  LOOP
    UPDATE public.assignments a SET check_out_at = s.end_at, check_out_method = 'auto', check_out_auto = true, status = 'worked'
      FROM public.shifts s WHERE a.id = r.id AND s.id = a.shift_id;
    PERFORM private.recalc_assignment_hours(r.id);
    n := n + 1;
  END LOOP;

  UPDATE public.assignments a
     SET status = 'no_show',
         reason_id = (SELECT d.id FROM public.directories d WHERE d.org_id = a.org_id AND d.kind = 'no_show_reason' AND d.is_active
                      ORDER BY d.sort_order LIMIT 1)
   FROM public.shifts s
   WHERE s.id = a.shift_id AND a.status IN ('assigned', 'confirmed') AND a.check_in_at IS NULL AND s.start_at + interval '2 hours' < now();
  GET DIAGNOSTICS m = ROW_COUNT;
  RETURN n + m;
END;
$$;

-- Нет отметки через 15 минут после начала — сигнал менеджеру (Т-5). Показывается в «Сегодня на объектах»;
-- доставка уведомлением — шаг 12. Права берутся у вызывающего, как у назначений.
CREATE OR REPLACE VIEW public.attendance_alerts WITH (security_invoker = true) AS
SELECT a.id AS assignment_id, a.shift_id, a.worker_id, s.site_id, s.org_id, s.start_at,
       floor(extract(epoch FROM (now() - s.start_at)) / 60)::integer AS minutes_late
FROM public.assignments a
JOIN public.shifts s ON s.id = a.shift_id
WHERE a.status IN ('assigned', 'confirmed') AND a.check_in_at IS NULL
  AND s.start_at + interval '15 minutes' < now() AND s.end_at > now();

GRANT SELECT ON public.attendance_alerts TO authenticated;

-- ============================================================
-- 5. Табель: сбор, отправка, подтверждение, споры
-- ============================================================
CREATE OR REPLACE FUNCTION private.timesheet_in_scope(_timesheet_id uuid, _action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.timesheets t
    WHERE t.id = _timesheet_id AND private.row_in_scope(t.org_id, 'timesheets', _action, private.site_row_owners(t.site_id))
  )
$$;

CREATE OR REPLACE FUNCTION private.timesheet_client_access(_timesheet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (SELECT 1 FROM public.timesheets t WHERE t.id = _timesheet_id AND private.is_client_contact(t.client_id))
$$;

-- Пересчёт статуса табеля по его строкам.
CREATE OR REPLACE FUNCTION private.refresh_timesheet_status(_timesheet_id uuid, _auto boolean DEFAULT false, _by uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  has_disputed boolean;
  has_pending boolean;
BEGIN
  SELECT bool_or(line_status = 'disputed'), bool_or(line_status = 'pending')
    INTO has_disputed, has_pending FROM public.assignments WHERE timesheet_id = _timesheet_id;
  IF coalesce(has_disputed, false) THEN
    UPDATE public.timesheets SET status = 'disputed' WHERE id = _timesheet_id AND status IN ('pending', 'disputed', 'confirmed');
  ELSIF coalesce(has_pending, false) THEN
    UPDATE public.timesheets SET status = 'pending' WHERE id = _timesheet_id AND status IN ('pending', 'disputed');
  ELSE
    UPDATE public.timesheets SET status = 'confirmed', confirmed_at = now(), confirmed_by = _by, confirmed_auto = _auto
     WHERE id = _timesheet_id AND status IN ('pending', 'disputed');
  END IF;
END;
$$;

-- Сбор табеля по объекту за период: отработанные смены, которые ещё не вошли в табель.
CREATE OR REPLACE FUNCTION public.build_timesheet(_site_id uuid, _from date, _to date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  s public.sites;
  t public.timesheets;
  n integer;
BEGIN
  SELECT * INTO s FROM public.sites WHERE id = _site_id;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT private.row_in_scope(s.org_id, 'timesheets', 'create', private.site_owner_ids(s.client_id, s.site_manager_id)) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF s.client_id IS NULL THEN
    RAISE EXCEPTION 'У объекта не указан заказчик' USING ERRCODE = '22023';
  END IF;
  IF _to < _from THEN
    RAISE EXCEPTION 'Конец периода раньше начала' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO t FROM public.timesheets WHERE site_id = _site_id AND period_from = _from AND period_to = _to;
  IF FOUND AND t.status <> 'draft' THEN
    RAISE EXCEPTION 'Табель за этот период уже отправлен заказчику' USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN
    INSERT INTO public.timesheets (org_id, site_id, client_id, period_from, period_to)
    VALUES (s.org_id, _site_id, s.client_id, _from, _to) RETURNING * INTO t;
  END IF;

  PERFORM set_config('app.timesheet_internal', 'on', true);
  UPDATE public.assignments a SET timesheet_id = t.id, line_status = 'pending'
    FROM public.shifts sh
   WHERE sh.id = a.shift_id AND sh.site_id = _site_id AND sh.shift_date BETWEEN _from AND _to
     AND a.status = 'worked' AND a.approved_hours IS NOT NULL AND a.timesheet_id IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('app.timesheet_internal', 'off', true);

  IF NOT EXISTS (SELECT 1 FROM public.assignments WHERE timesheet_id = t.id) THEN
    DELETE FROM public.timesheets WHERE id = t.id;
    RAISE EXCEPTION 'За этот период нет отработанных смен, которые ещё не вошли в табель' USING ERRCODE = '22023';
  END IF;
  RETURN t.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_timesheet(_timesheet_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  t public.timesheets;
  hours numeric;
  deadline timestamptz;
BEGIN
  SELECT * INTO t FROM public.timesheets WHERE id = _timesheet_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.timesheet_in_scope(_timesheet_id, 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF t.status <> 'draft' THEN
    RAISE EXCEPTION 'Отправить можно только черновик' USING ERRCODE = '22023';
  END IF;
  -- Срок подтверждения берётся из настройки заказчика (по умолчанию 48 часов, Т-12).
  hours := coalesce(public.get_setting_numeric(t.org_id, 'timesheet.autoconfirm_hours', current_date, t.client_id), 48);
  deadline := now() + make_interval(secs => hours * 3600);
  UPDATE public.timesheets SET status = 'pending', sent_at = now(), sent_by = auth.uid(), confirm_deadline = deadline WHERE id = _timesheet_id;
  RETURN deadline;
END;
$$;

-- Заказчик подтверждает табель целиком; спорные строки остаются спорными (Т-11).
CREATE OR REPLACE FUNCTION public.confirm_timesheet(_timesheet_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  t public.timesheets;
  r record;
BEGIN
  SELECT * INTO t FROM public.timesheets WHERE id = _timesheet_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.is_client_contact(t.client_id) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF t.status NOT IN ('pending', 'disputed') THEN
    RAISE EXCEPTION 'Этот табель подтвердить нельзя' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.timesheet_internal', 'on', true);
  FOR r IN SELECT id FROM public.assignments WHERE timesheet_id = _timesheet_id AND line_status = 'pending' LOOP
    UPDATE public.assignments SET line_status = 'confirmed' WHERE id = r.id;
    PERFORM private.create_accrual_for_assignment(r.id);
  END LOOP;
  PERFORM set_config('app.timesheet_internal', 'off', true);
  PERFORM private.refresh_timesheet_status(_timesheet_id, false, auth.uid());
END;
$$;

-- Заказчик оспаривает строку: причина и предложенные часы (Т-11).
CREATE OR REPLACE FUNCTION public.dispute_line(_timesheet_id uuid, _assignment_id uuid, _proposed_hours numeric, _reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  t public.timesheets;
  a public.assignments;
  did uuid;
BEGIN
  SELECT * INTO t FROM public.timesheets WHERE id = _timesheet_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.is_client_contact(t.client_id) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO a FROM public.assignments WHERE id = _assignment_id AND timesheet_id = _timesheet_id;
  IF NOT FOUND OR a.line_status <> 'pending' OR t.status NOT IN ('pending', 'disputed') THEN
    RAISE EXCEPTION 'Эту строку оспорить нельзя' USING ERRCODE = '22023';
  END IF;
  IF _proposed_hours < 0 OR nullif(btrim(coalesce(_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Укажите причину и предложенные часы' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.timesheet_disputes (org_id, timesheet_id, assignment_id, proposed_hours, original_hours, reason)
  VALUES (t.org_id, _timesheet_id, _assignment_id, _proposed_hours, a.approved_hours, _reason) RETURNING id INTO did;
  INSERT INTO public.timesheet_dispute_messages (dispute_id, author_side, body) VALUES (did, 'client', _reason);

  PERFORM set_config('app.timesheet_internal', 'on', true);
  UPDATE public.assignments SET line_status = 'disputed' WHERE id = _assignment_id;
  PERFORM set_config('app.timesheet_internal', 'off', true);
  UPDATE public.timesheets SET status = 'disputed' WHERE id = _timesheet_id;
  RETURN did;
END;
$$;

-- Менеджер принимает правку или отклоняет с комментарием и отправляет строку повторно (Т-13).
CREATE OR REPLACE FUNCTION public.resolve_dispute(_dispute_id uuid, _accept boolean, _comment text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  d public.timesheet_disputes;
  t public.timesheets;
  hours numeric;
BEGIN
  SELECT * INTO d FROM public.timesheet_disputes WHERE id = _dispute_id AND status = 'open' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Спор не найден или уже решён' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.timesheets WHERE id = d.timesheet_id FOR UPDATE;
  IF auth.uid() IS NULL OR NOT private.timesheet_in_scope(d.timesheet_id, 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF NOT _accept AND nullif(btrim(coalesce(_comment, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Отклоняя правку, объясните причину' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.timesheet_internal', 'on', true);
  IF _accept THEN
    UPDATE public.assignments SET approved_hours = d.proposed_hours, line_status = 'confirmed' WHERE id = d.assignment_id;
    PERFORM private.create_accrual_for_assignment(d.assignment_id);
  ELSE
    UPDATE public.assignments SET line_status = 'pending' WHERE id = d.assignment_id;
  END IF;
  PERFORM set_config('app.timesheet_internal', 'off', true);

  UPDATE public.timesheet_disputes SET status = CASE WHEN _accept THEN 'accepted' ELSE 'rejected' END,
         resolution_comment = _comment, resolved_by = auth.uid(), resolved_at = now() WHERE id = _dispute_id;
  IF nullif(btrim(coalesce(_comment, '')), '') IS NOT NULL THEN
    INSERT INTO public.timesheet_dispute_messages (dispute_id, author_side, body) VALUES (_dispute_id, 'manager', _comment);
  END IF;

  -- Строка вернулась заказчику: срок подтверждения отсчитывается заново.
  IF NOT _accept THEN
    hours := coalesce(public.get_setting_numeric(t.org_id, 'timesheet.autoconfirm_hours', current_date, t.client_id), 48);
    UPDATE public.timesheets SET confirm_deadline = now() + make_interval(secs => hours * 3600) WHERE id = t.id;
  END IF;
  PERFORM private.refresh_timesheet_status(d.timesheet_id, false, NULL);
END;
$$;

-- Не ответил за срок — табель подтверждается автоматически (Т-12). Спорные строки остаются за менеджером.
CREATE OR REPLACE FUNCTION private.autoconfirm_timesheets()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  t record;
  r record;
  n integer := 0;
BEGIN
  FOR t IN SELECT id FROM public.timesheets WHERE status IN ('pending', 'disputed') AND confirm_deadline <= now() FOR UPDATE LOOP
    PERFORM set_config('app.timesheet_internal', 'on', true);
    FOR r IN SELECT id FROM public.assignments WHERE timesheet_id = t.id AND line_status = 'pending' LOOP
      UPDATE public.assignments SET line_status = 'confirmed' WHERE id = r.id;
      PERFORM private.create_accrual_for_assignment(r.id);
    END LOOP;
    PERFORM set_config('app.timesheet_internal', 'off', true);
    PERFORM private.refresh_timesheet_status(t.id, true, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- Строки табеля для экрана менеджера и заказчика: без ставок и денег, только факт.
CREATE OR REPLACE FUNCTION public.timesheet_lines(_timesheet_id uuid)
RETURNS TABLE (assignment_id uuid, shift_date date, worker_id uuid, worker_name text, position_name text, planned_hours numeric,
               check_in_at timestamptz, check_out_at timestamptz, approved_hours numeric, late_minutes integer,
               manual_in boolean, manual_out boolean, auto_out boolean, overtime_hours numeric, overtime_approved_hours numeric,
               line_status text, dispute_id uuid, dispute_status text, dispute_proposed numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (private.timesheet_in_scope(_timesheet_id, 'view') OR private.timesheet_client_access(_timesheet_id)) THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.id, sh.shift_date, a.worker_id, w.full_name, p.name, a.planned_hours, a.check_in_at, a.check_out_at, a.approved_hours,
         a.late_minutes, a.check_in_method = 'manual', a.check_out_method = 'manual', a.check_out_auto,
         a.overtime_hours, a.overtime_approved_hours, a.line_status,
         d.id, d.status, d.proposed_hours
  FROM public.assignments a
  JOIN public.shifts sh ON sh.id = a.shift_id
  JOIN public.workers w ON w.user_id = a.worker_id
  JOIN public.positions p ON p.id = sh.position_id
  LEFT JOIN LATERAL (SELECT x.id, x.status, x.proposed_hours FROM public.timesheet_disputes x
                     WHERE x.assignment_id = a.id ORDER BY x.created_at DESC LIMIT 1) d ON true
  WHERE a.timesheet_id = _timesheet_id
  ORDER BY sh.shift_date, w.full_name;
END;
$$;

-- ============================================================
-- 6. Оценки и рейтинг (Т-16, Т-17)
-- ============================================================
-- Рейтинг за окно в днях: средняя оценка минус штраф за каждую неявку и позднюю отмену, не ниже порога.
-- Значения (90 дней, 0,5 и 0,2) — настройки, формула в разделе 21 ТЗ ждёт подтверждения клиента.
CREATE OR REPLACE FUNCTION private.recompute_worker_rating(_worker_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  w public.workers;
  win numeric;
  pn numeric;
  pl numeric;
  floor_value numeric;
  avg_rating numeric;
  no_shows integer;
  late_cancels integer;
BEGIN
  SELECT * INTO w FROM public.workers WHERE user_id = _worker_id;
  IF NOT FOUND THEN RETURN; END IF;
  win := coalesce(public.get_setting_numeric(w.org_id, 'rating.window_days'), 90);
  pn := coalesce(public.get_setting_numeric(w.org_id, 'rating.penalty_no_show'), 0.5);
  pl := coalesce(public.get_setting_numeric(w.org_id, 'rating.penalty_late_cancel'), 0.2);
  floor_value := greatest(1, coalesce(public.get_setting_numeric(w.org_id, 'rating.min_value'), 1));

  SELECT avg(r) INTO avg_rating FROM (
    SELECT client_rating::numeric AS r FROM public.assignments
     WHERE worker_id = _worker_id AND client_rating IS NOT NULL AND shift_start > now() - make_interval(days => win::integer)
    UNION ALL
    SELECT manager_rating::numeric FROM public.assignments
     WHERE worker_id = _worker_id AND manager_rating IS NOT NULL AND shift_start > now() - make_interval(days => win::integer)
  ) x;

  SELECT count(*) FILTER (WHERE status = 'no_show'), count(*) FILTER (WHERE late_cancel)
    INTO no_shows, late_cancels
  FROM public.assignments WHERE worker_id = _worker_id AND shift_start > now() - make_interval(days => win::integer);

  UPDATE public.workers SET rating = CASE WHEN avg_rating IS NULL THEN NULL
                                          ELSE least(5, greatest(floor_value, round(avg_rating - pn * no_shows - pl * late_cancels, 2))) END
   WHERE user_id = _worker_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.assignments_rating_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  PERFORM private.recompute_worker_rating(NEW.worker_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER assignments_rating
  AFTER UPDATE OF client_rating, manager_rating, status, late_cancel ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION private.assignments_rating_trigger();

-- Окно рейтинга скользит со временем, поэтому раз в сутки пересчитываем всех. Вызывается по расписанию.
CREATE OR REPLACE FUNCTION private.recompute_all_ratings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN SELECT DISTINCT worker_id FROM public.assignments WHERE client_rating IS NOT NULL OR manager_rating IS NOT NULL OR status = 'no_show' OR late_cancel LOOP
    PERFORM private.recompute_worker_rating(r.worker_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- Оценка по назначению: менеджер и заказчик, каждый свою. Оценка «1» от заказчика может сразу внести
-- исполнителя в стоп-лист его объекта.
CREATE OR REPLACE FUNCTION public.rate_assignment(_assignment_id uuid, _rating integer, _comment text DEFAULT NULL, _blocklist boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  a public.assignments;
  s public.shifts;
BEGIN
  IF _rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Оценка — от 1 до 5' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM public.assignments WHERE id = _assignment_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF a.status <> 'worked' THEN
    RAISE EXCEPTION 'Оценить можно отработанную смену' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.shifts WHERE id = a.shift_id;

  IF private.shift_assign_in_scope(a.shift_id, 'update') THEN
    PERFORM set_config('app.timesheet_internal', 'on', true);
    UPDATE public.assignments SET manager_rating = _rating, manager_comment = _comment WHERE id = _assignment_id;
    PERFORM set_config('app.timesheet_internal', 'off', true);
  ELSIF private.is_client_contact(s.client_id) THEN
    PERFORM set_config('app.timesheet_internal', 'on', true);
    UPDATE public.assignments SET client_rating = _rating, client_comment = _comment WHERE id = _assignment_id;
    PERFORM set_config('app.timesheet_internal', 'off', true);
    IF _rating = 1 AND _blocklist THEN
      INSERT INTO public.worker_blocks (org_id, worker_id, site_id, reason, created_by)
      VALUES (a.org_id, a.worker_id, s.site_id, 'Оценка 1 от заказчика' || coalesce(': ' || _comment, ''), auth.uid());
    END IF;
  ELSE
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_in(uuid, numeric, numeric, numeric, text), public.check_out(uuid, numeric, numeric, numeric, text),
  public.manual_check(uuid, text, timestamptz, text), public.brigade_check(uuid, uuid[], text, text),
  public.approve_overtime(uuid, numeric), public.build_timesheet(uuid, date, date), public.send_timesheet(uuid),
  public.confirm_timesheet(uuid), public.dispute_line(uuid, uuid, numeric, text), public.resolve_dispute(uuid, boolean, text),
  public.timesheet_lines(uuid), public.rate_assignment(uuid, integer, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_in(uuid, numeric, numeric, numeric, text), public.check_out(uuid, numeric, numeric, numeric, text),
  public.manual_check(uuid, text, timestamptz, text), public.brigade_check(uuid, uuid[], text, text),
  public.approve_overtime(uuid, numeric), public.build_timesheet(uuid, date, date), public.send_timesheet(uuid),
  public.confirm_timesheet(uuid), public.dispute_line(uuid, uuid, numeric, text), public.resolve_dispute(uuid, boolean, text),
  public.timesheet_lines(uuid), public.rate_assignment(uuid, integer, text, boolean) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.recalc_assignment_hours(uuid), private.do_manual_check(uuid, text, timestamptz, text, uuid),
  private.process_attendance(), private.autoconfirm_timesheets(), private.recompute_worker_rating(uuid), private.recompute_all_ratings(),
  private.refresh_timesheet_status(uuid, boolean, uuid), private.create_accrual_for_assignment(uuid),
  private.validate_checkpoint(public.sites, numeric, numeric, text), private.split_minutes(timestamptz, timestamptz, text, uuid),
  private.distance_m(numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.recalc_assignment_hours(uuid), private.do_manual_check(uuid, text, timestamptz, text, uuid),
  private.process_attendance(), private.autoconfirm_timesheets(), private.recompute_worker_rating(uuid), private.recompute_all_ratings(),
  private.refresh_timesheet_status(uuid, boolean, uuid), private.create_accrual_for_assignment(uuid),
  private.validate_checkpoint(public.sites, numeric, numeric, text), private.split_minutes(timestamptz, timestamptz, text, uuid),
  private.distance_m(numeric, numeric, numeric, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION private.timesheet_in_scope(uuid, text), private.timesheet_client_access(uuid) TO authenticated, service_role;

-- ============================================================
-- 7. Доступ
-- ============================================================
ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheet_dispute_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.timesheets, public.timesheet_disputes, public.timesheet_dispute_messages FROM anon, authenticated;
GRANT SELECT ON public.timesheets, public.timesheet_disputes, public.timesheet_dispute_messages TO authenticated;
GRANT ALL ON public.timesheets, public.timesheet_disputes, public.timesheet_dispute_messages TO service_role;

CREATE POLICY "Timesheets: view in scope or own company" ON public.timesheets FOR SELECT TO authenticated
  USING (private.row_in_scope(org_id, 'timesheets', 'view', private.site_row_owners(site_id)) OR private.is_client_contact(client_id));
CREATE POLICY "Disputes: view" ON public.timesheet_disputes FOR SELECT TO authenticated
  USING (private.timesheet_in_scope(timesheet_id, 'view') OR private.timesheet_client_access(timesheet_id));
CREATE POLICY "Dispute messages: view" ON public.timesheet_dispute_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.timesheet_disputes d WHERE d.id = dispute_id
                 AND (private.timesheet_in_scope(d.timesheet_id, 'view') OR private.timesheet_client_access(d.timesheet_id))));
