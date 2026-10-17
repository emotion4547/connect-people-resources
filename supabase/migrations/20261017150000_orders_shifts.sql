-- Этап 1, шаг 6: заказы и смены. ТЗ: разделы 4 и 8 (О-3…О-6, О-15…О-17, статусы).
--
-- Заказ — потребность заказчика (объект, позиция, период, график, число людей). Принятый заказ
-- раскладывается на смены по дням; в каждую смену копируются ставки утверждённого тарифа
-- на её дату, так что правка тарифа смену не меняет.
--
-- Старая таблица requests и кабинеты HR/исполнителя продолжают работать как раньше: переезд заявок
-- в заказы — шаг 13, кабинеты — шаг 11. Назначения людей на смены — шаг 7.

-- ============================================================
-- 1. Вспомогательные функции доступа
-- ============================================================
-- Ответственные за объект по его идентификатору: менеджер объекта и менеджер заказчика по объектам.
CREATE OR REPLACE FUNCTION private.site_row_owners(_site_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT private.site_owner_ids(s.client_id, s.site_manager_id) FROM public.sites s WHERE s.id = _site_id
$$;

REVOKE EXECUTE ON FUNCTION private.site_row_owners(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.site_row_owners(uuid) TO authenticated, service_role;

-- ============================================================
-- 2. Заказы
-- ============================================================
CREATE TABLE public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  site_id uuid NOT NULL,
  position_id uuid NOT NULL,
  unit text NOT NULL DEFAULT 'hour' CHECK (unit IN ('hour', 'shift', 'piece')),
  date_from date NOT NULL,
  date_to date NOT NULL,
  -- Дни недели (1 — понедельник … 7 — воскресенье). Пусто — каждый день периода.
  weekdays smallint[] CHECK (weekdays IS NULL OR weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  -- Либо явный список дат: тогда период берётся из него.
  dates date[],
  start_time time NOT NULL,
  -- Конец раньше или равен началу — смена через полночь. Равные — не допускаются.
  end_time time NOT NULL,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 480),
  headcount integer NOT NULL CHECK (headcount >= 1),
  reserve_count integer NOT NULL DEFAULT 0 CHECK (reserve_count >= 0),
  requirements text,
  comment text,
  -- Новый → Принят → В работе → Завершён; Отменён.
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'in_progress', 'completed', 'cancelled')),
  source text NOT NULL DEFAULT 'manager' CHECK (source IN ('cabinet', 'manager')),
  -- Начало первой смены: по нему заказ с началом меньше чем через 24 часа поднимается как «срочный».
  starts_at timestamptz,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  cancel_reason_id uuid REFERENCES public.directories(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, client_id) REFERENCES public.clients (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, site_id) REFERENCES public.sites (org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, position_id) REFERENCES public.positions (org_id, id) ON DELETE RESTRICT,
  UNIQUE (org_id, id),
  CONSTRAINT orders_period_ordered CHECK (date_to >= date_from),
  CONSTRAINT orders_period_limited CHECK (date_to - date_from <= 366),
  CONSTRAINT orders_times_differ CHECK (start_time <> end_time)
);

CREATE INDEX orders_org_status_idx ON public.orders (org_id, status, starts_at);
CREATE INDEX orders_client_idx ON public.orders (client_id);
CREATE INDEX orders_site_idx ON public.orders (site_id);

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_orders
  AFTER INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes(
    'client_id', 'site_id', 'position_id', 'unit', 'date_from', 'date_to', 'weekdays', 'dates', 'start_time',
    'end_time', 'headcount', 'reserve_count', 'status', 'source', 'cancel_reason_id');

-- Даты заказа: явный список или период с отбором по дням недели.
CREATE OR REPLACE FUNCTION private.order_dates(o public.orders)
RETURNS SETOF date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT d::date FROM (
    SELECT unnest(o.dates) AS d WHERE coalesce(array_length(o.dates, 1), 0) > 0
    UNION
    SELECT g FROM generate_series(o.date_from, o.date_to, interval '1 day') g
      WHERE coalesce(array_length(o.dates, 1), 0) = 0
        AND (o.weekdays IS NULL OR cardinality(o.weekdays) = 0 OR extract(isodow FROM g)::smallint = ANY (o.weekdays))
  ) t ORDER BY 1
$$;

-- Проверки и вычисляемые поля заказа.
CREATE OR REPLACE FUNCTION private.orders_prepare()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  s public.sites;
  c public.clients;
  first_date date;
BEGIN
  SELECT * INTO s FROM public.sites WHERE id = NEW.site_id;
  SELECT * INTO c FROM public.clients WHERE id = NEW.client_id;

  IF s.client_id IS DISTINCT FROM NEW.client_id THEN
    RAISE EXCEPTION 'Объект не принадлежит этому заказчику' USING ERRCODE = '22023';
  END IF;

  -- Явный список дат определяет период.
  IF coalesce(array_length(NEW.dates, 1), 0) > 0 THEN
    NEW.dates := ARRAY(SELECT DISTINCT d FROM unnest(NEW.dates) d ORDER BY d);
    NEW.date_from := NEW.dates[1];
    NEW.date_to := NEW.dates[array_length(NEW.dates, 1)];
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF c.status IN ('archived', 'paused') THEN
      RAISE EXCEPTION 'Заказчик в статусе «%»: заказ создать нельзя', CASE c.status WHEN 'archived' THEN 'Архив' ELSE 'Пауза' END
        USING ERRCODE = '22023';
    END IF;
    -- Заказ можно создать только по утверждённому тарифу: так маржа известна до первой смены.
    IF public.get_tariff(NEW.client_id, NEW.site_id, NEW.position_id, NEW.unit, NEW.date_from) IS NULL THEN
      RAISE EXCEPTION 'Нет утверждённого тарифа заказчика на эту позицию и дату %', NEW.date_from USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT min(d) INTO first_date FROM private.order_dates(NEW) d;
  IF first_date IS NULL THEN
    RAISE EXCEPTION 'В выбранном периоде нет ни одного подходящего дня' USING ERRCODE = '22023';
  END IF;
  NEW.starts_at := (first_date + NEW.start_time)::timestamp AT TIME ZONE s.timezone;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_prepare
  BEFORE INSERT OR UPDATE OF client_id, site_id, position_id, unit, date_from, date_to, weekdays, dates, start_time ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.orders_prepare();

-- ============================================================
-- 3. Смены и ставки смен
-- ============================================================
CREATE TABLE public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  client_id uuid NOT NULL,
  site_id uuid NOT NULL,
  position_id uuid NOT NULL,
  shift_date date NOT NULL,
  -- Ночная смена через полночь — одна смена: конец позже начала на следующие сутки.
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  break_minutes integer NOT NULL DEFAULT 0,
  headcount integer NOT NULL CHECK (headcount >= 1),
  reserve_count integer NOT NULL DEFAULT 0 CHECK (reserve_count >= 0),
  -- Открыта → Укомплектована → Идёт → Завершена; Отменена.
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'staffed', 'running', 'completed', 'cancelled')),
  -- Пока объект в статусе «Запуск», смена исполнителям не публикуется (раздел 8, О-1).
  published_at timestamptz,
  cancel_reason_id uuid REFERENCES public.directories(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, order_id) REFERENCES public.orders (org_id, id) ON DELETE CASCADE,
  UNIQUE (org_id, id),
  UNIQUE (order_id, shift_date),
  CONSTRAINT shifts_end_after_start CHECK (end_at > start_at)
);

CREATE INDEX shifts_site_start_idx ON public.shifts (site_id, start_at);
CREATE INDEX shifts_org_start_idx ON public.shifts (org_id, start_at);
CREATE INDEX shifts_order_idx ON public.shifts (order_id);

CREATE TRIGGER update_shifts_updated_at
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER audit_shifts
  AFTER INSERT OR UPDATE OR DELETE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION private.audit_changes('order_id', 'shift_date', 'start_at', 'end_at', 'headcount', 'reserve_count', 'status');

-- Ставки утверждённого тарифа на момент создания смены. Отдельной таблицей, потому что смены видит
-- и заказчик, а ставку исполнителя ему показывать нельзя.
CREATE TABLE public.shift_rates (
  shift_id uuid PRIMARY KEY REFERENCES public.shifts(id) ON DELETE CASCADE,
  org_id uuid NOT NULL,
  client_id uuid NOT NULL,
  tariff_id uuid REFERENCES public.tariffs(id) ON DELETE SET NULL,
  unit text NOT NULL,
  client_rate numeric(12,2) NOT NULL,
  worker_rate numeric(12,2) NOT NULL,
  night_coef numeric(4,2) NOT NULL,
  holiday_coef numeric(4,2) NOT NULL,
  overtime_coef numeric(4,2) NOT NULL,
  min_paid_hours numeric(5,2) NOT NULL,
  min_paid_hours_for_worker boolean NOT NULL
);

-- Число людей на смене (пока 0): шаг 7 переопределит функцию по таблице назначений.
CREATE OR REPLACE FUNCTION private.shift_assignment_count(_shift_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$ SELECT 0 $$;

-- Раскладывает заказ на смены по дням. Дата без утверждённого тарифа останавливает всё:
-- смена без ставок не создаётся.
CREATE OR REPLACE FUNCTION private.generate_shifts(_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  o public.orders;
  s public.sites;
  d date;
  t public.tariffs;
  sh_id uuid;
  v_start timestamptz;
  v_end timestamptz;
  n integer := 0;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  SELECT * INTO s FROM public.sites WHERE id = o.site_id;

  FOR d IN SELECT x FROM private.order_dates(o) x LOOP
    t := public.get_tariff(o.client_id, o.site_id, o.position_id, o.unit, d);
    IF t.id IS NULL THEN
      RAISE EXCEPTION 'Нет утверждённого тарифа на %', d USING ERRCODE = '22023';
    END IF;

    v_start := (d + o.start_time)::timestamp AT TIME ZONE s.timezone;
    v_end := (d + o.end_time)::timestamp AT TIME ZONE s.timezone;
    IF o.end_time <= o.start_time THEN
      v_end := ((d + 1) + o.end_time)::timestamp AT TIME ZONE s.timezone;
    END IF;

    INSERT INTO public.shifts (org_id, order_id, client_id, site_id, position_id, shift_date, start_at, end_at,
                               break_minutes, headcount, reserve_count, published_at)
    VALUES (o.org_id, o.id, o.client_id, o.site_id, o.position_id, d, v_start, v_end,
            o.break_minutes, o.headcount, o.reserve_count, CASE WHEN s.status = 'active' THEN now() END)
    ON CONFLICT (order_id, shift_date) DO NOTHING
    RETURNING id INTO sh_id;

    IF sh_id IS NOT NULL THEN
      INSERT INTO public.shift_rates (shift_id, org_id, client_id, tariff_id, unit, client_rate, worker_rate,
                                      night_coef, holiday_coef, overtime_coef, min_paid_hours, min_paid_hours_for_worker)
      VALUES (sh_id, o.org_id, o.client_id, t.id, t.unit, t.client_rate, t.worker_rate,
              t.night_coef, t.holiday_coef, t.overtime_coef, t.min_paid_hours, t.min_paid_hours_for_worker);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- Смены объекта публикуются, когда объект запущен.
CREATE OR REPLACE FUNCTION private.sites_publish_shifts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active' THEN
    UPDATE public.shifts SET published_at = now()
     WHERE site_id = NEW.id AND published_at IS NULL AND status IN ('open', 'staffed');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sites_publish_shifts
  AFTER UPDATE OF status ON public.sites
  FOR EACH ROW EXECUTE FUNCTION private.sites_publish_shifts();

-- ============================================================
-- 4. Действия над заказом
-- ============================================================
CREATE OR REPLACE FUNCTION private.order_in_scope(_order_id uuid, _action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = _order_id AND private.row_in_scope(o.org_id, 'orders', _action, private.site_row_owners(o.site_id))
  )
$$;

REVOKE EXECUTE ON FUNCTION private.order_in_scope(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.order_in_scope(uuid, text) TO authenticated, service_role;

-- Принять заказ: проверить, создать смены. Возвращает число созданных смен.
CREATE OR REPLACE FUNCTION public.accept_order(_order_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  o public.orders;
  n integer;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.order_in_scope(_order_id, 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF o.status <> 'new' THEN
    RAISE EXCEPTION 'Принять можно только новый заказ' USING ERRCODE = '22023';
  END IF;

  n := private.generate_shifts(_order_id);
  UPDATE public.orders SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now() WHERE id = _order_id;
  RETURN n;
END;
$$;

-- План изменения смен после правки заказа (О-5): добавить, обновить, убрать будущие смены.
-- Смены с людьми молча не удаляются и не сдвигаются: они возвращаются как «blocked», решает менеджер.
-- Прошедшие и идущие смены не трогаются. При _dry_run = false безопасные действия выполняются.
CREATE OR REPLACE FUNCTION public.regenerate_order_shifts(_order_id uuid, _dry_run boolean DEFAULT true)
RETURNS TABLE (shift_date date, action text, affected integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  o public.orders;
  s public.sites;
  r record;
  d date;
  t public.tariffs;
  v_start timestamptz;
  v_end timestamptz;
  sh_id uuid;
  cnt integer;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.order_in_scope(_order_id, 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF o.status NOT IN ('accepted', 'in_progress') THEN
    RAISE EXCEPTION 'Смены перестраиваются только у принятого заказа' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO s FROM public.sites WHERE id = o.site_id;

  -- Лишние будущие смены и смены, у которых изменились время или число людей.
  FOR r IN
    SELECT sh.* FROM public.shifts sh
    WHERE sh.order_id = _order_id AND sh.start_at > now() AND sh.status IN ('open', 'staffed')
    ORDER BY sh.shift_date
  LOOP
    cnt := private.shift_assignment_count(r.id);
    v_start := (r.shift_date + o.start_time)::timestamp AT TIME ZONE s.timezone;
    v_end := CASE WHEN o.end_time <= o.start_time
                  THEN ((r.shift_date + 1) + o.end_time)::timestamp AT TIME ZONE s.timezone
                  ELSE (r.shift_date + o.end_time)::timestamp AT TIME ZONE s.timezone END;

    IF NOT EXISTS (SELECT 1 FROM private.order_dates(o) x WHERE x = r.shift_date) THEN
      shift_date := r.shift_date; affected := cnt;
      IF cnt > 0 THEN
        action := 'blocked';
      ELSE
        action := 'remove';
        IF NOT _dry_run THEN DELETE FROM public.shifts WHERE id = r.id; END IF;
      END IF;
      RETURN NEXT;
    ELSIF r.start_at <> v_start OR r.end_at <> v_end OR r.break_minutes <> o.break_minutes
          OR r.headcount <> o.headcount OR r.reserve_count <> o.reserve_count THEN
      shift_date := r.shift_date; affected := cnt;
      IF cnt > 0 AND (r.start_at <> v_start OR r.end_at <> v_end) THEN
        action := 'blocked';
      ELSE
        action := 'update';
        IF NOT _dry_run THEN
          UPDATE public.shifts SET start_at = v_start, end_at = v_end, break_minutes = o.break_minutes,
                 headcount = o.headcount, reserve_count = o.reserve_count WHERE id = r.id;
        END IF;
      END IF;
      RETURN NEXT;
    END IF;
  END LOOP;

  -- Новые даты (только будущие).
  FOR d IN SELECT x FROM private.order_dates(o) x LOOP
    IF EXISTS (SELECT 1 FROM public.shifts sh WHERE sh.order_id = _order_id AND sh.shift_date = d) THEN CONTINUE; END IF;
    v_start := (d + o.start_time)::timestamp AT TIME ZONE s.timezone;
    IF v_start <= now() THEN CONTINUE; END IF;

    shift_date := d; action := 'add'; affected := 0;
    IF NOT _dry_run THEN
      t := public.get_tariff(o.client_id, o.site_id, o.position_id, o.unit, d);
      IF t.id IS NULL THEN
        RAISE EXCEPTION 'Нет утверждённого тарифа на %', d USING ERRCODE = '22023';
      END IF;
      v_end := CASE WHEN o.end_time <= o.start_time
                    THEN ((d + 1) + o.end_time)::timestamp AT TIME ZONE s.timezone
                    ELSE (d + o.end_time)::timestamp AT TIME ZONE s.timezone END;
      INSERT INTO public.shifts (org_id, order_id, client_id, site_id, position_id, shift_date, start_at, end_at,
                                 break_minutes, headcount, reserve_count, published_at)
      VALUES (o.org_id, o.id, o.client_id, o.site_id, o.position_id, d, v_start, v_end,
              o.break_minutes, o.headcount, o.reserve_count, CASE WHEN s.status = 'active' THEN now() END)
      RETURNING id INTO sh_id;
      INSERT INTO public.shift_rates (shift_id, org_id, client_id, tariff_id, unit, client_rate, worker_rate,
                                      night_coef, holiday_coef, overtime_coef, min_paid_hours, min_paid_hours_for_worker)
      VALUES (sh_id, o.org_id, o.client_id, t.id, t.unit, t.client_rate, t.worker_rate,
              t.night_coef, t.holiday_coef, t.overtime_coef, t.min_paid_hours, t.min_paid_hours_for_worker);
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- «Повторить неделю» (О-6): копия заказа на следующую неделю со своими сменами и текущими ставками.
-- Копирование назначений по галочке добавит шаг 7.
CREATE OR REPLACE FUNCTION public.repeat_order_week(_order_id uuid, _copy_assignments boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  o public.orders;
  new_id uuid;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.order_in_scope(_order_id, 'create') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF o.status = 'new' THEN
    RAISE EXCEPTION 'Сначала примите заказ' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.orders (org_id, client_id, site_id, position_id, unit, date_from, date_to, weekdays, dates,
                             start_time, end_time, break_minutes, headcount, reserve_count, requirements, comment, source)
  VALUES (o.org_id, o.client_id, o.site_id, o.position_id, o.unit, o.date_from + 7, o.date_to + 7, o.weekdays,
          (SELECT array_agg(x + 7) FROM unnest(o.dates) x),
          o.start_time, o.end_time, o.break_minutes, o.headcount, o.reserve_count, o.requirements, o.comment, 'manager')
  RETURNING id INTO new_id;

  PERFORM private.generate_shifts(new_id);
  UPDATE public.orders SET status = 'accepted', accepted_by = auth.uid(), accepted_at = now() WHERE id = new_id;
  RETURN new_id;
END;
$$;

-- Отмена заказа с причиной из справочника (О-17). Будущие смены отменяются; прошедшие остаются.
CREATE OR REPLACE FUNCTION public.cancel_order(_order_id uuid, _reason_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  o public.orders;
BEGIN
  SELECT * INTO o FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.order_in_scope(_order_id, 'update') THEN
    RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501';
  END IF;
  IF o.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Завершённый или уже отменённый заказ отменить нельзя' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.directories d WHERE d.id = _reason_id AND d.kind = 'cancel_reason' AND d.org_id = o.org_id AND d.is_active) THEN
    RAISE EXCEPTION 'Выберите причину отмены из справочника' USING ERRCODE = '22023';
  END IF;

  UPDATE public.shifts SET status = 'cancelled', cancel_reason_id = _reason_id
   WHERE order_id = _order_id AND start_at > now() AND status IN ('open', 'staffed');
  UPDATE public.orders SET status = 'cancelled', cancel_reason_id = _reason_id, cancelled_at = now() WHERE id = _order_id;
END;
$$;

-- Смены «идут» и «завершаются» по времени; вместе с ними двигается статус заказа.
-- Вызывается по расписанию (раз в несколько минут), см. deploy/README.md.
CREATE OR REPLACE FUNCTION private.advance_shift_statuses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  n integer := 0;
  k integer;
BEGIN
  UPDATE public.shifts SET status = 'running'
   WHERE status IN ('open', 'staffed') AND start_at <= now() AND end_at > now();
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;

  UPDATE public.shifts SET status = 'completed'
   WHERE status IN ('open', 'staffed', 'running') AND end_at <= now();
  GET DIAGNOSTICS k = ROW_COUNT; n := n + k;

  UPDATE public.orders o SET status = 'in_progress'
   WHERE o.status = 'accepted' AND EXISTS (SELECT 1 FROM public.shifts s WHERE s.order_id = o.id AND s.status IN ('running', 'completed'));

  UPDATE public.orders o SET status = 'completed'
   WHERE o.status IN ('accepted', 'in_progress')
     AND EXISTS (SELECT 1 FROM public.shifts s WHERE s.order_id = o.id)
     AND NOT EXISTS (SELECT 1 FROM public.shifts s WHERE s.order_id = o.id AND s.status NOT IN ('completed', 'cancelled'));
  RETURN n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.accept_order(uuid), public.regenerate_order_shifts(uuid, boolean),
  public.repeat_order_week(uuid, boolean), public.cancel_order(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_order(uuid), public.regenerate_order_shifts(uuid, boolean),
  public.repeat_order_week(uuid, boolean), public.cancel_order(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.generate_shifts(uuid), private.advance_shift_statuses(),
  private.shift_assignment_count(uuid), private.order_dates(public.orders) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.generate_shifts(uuid), private.advance_shift_statuses(),
  private.shift_assignment_count(uuid), private.order_dates(public.orders) TO service_role;
GRANT EXECUTE ON FUNCTION private.order_dates(public.orders) TO authenticated;

-- ============================================================
-- 5. Политики
-- ============================================================
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_rates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.orders, public.shifts, public.shift_rates FROM anon, authenticated;
GRANT SELECT, INSERT ON public.orders TO authenticated;
GRANT UPDATE (date_from, date_to, weekdays, dates, start_time, end_time, break_minutes, headcount, reserve_count, requirements, comment)
  ON public.orders TO authenticated;
GRANT SELECT ON public.shifts, public.shift_rates TO authenticated;
GRANT ALL ON public.orders, public.shifts, public.shift_rates TO service_role;

-- Заказы: сотрудники по матрице прав, человек из кабинета — свои. Принимает, отменяет и
-- перестраивает смены только функция; прямая правка параметров — пока заказ новый или принят.
CREATE POLICY "Orders: view in scope or own company" ON public.orders FOR SELECT TO authenticated
  USING (
    private.row_in_scope(org_id, 'orders', 'view', private.site_row_owners(site_id))
    OR private.is_client_contact(client_id)
  );
CREATE POLICY "Orders: staff create new" ON public.orders FOR INSERT TO authenticated
  WITH CHECK (
    status = 'new' AND source = 'manager'
    AND private.row_in_scope(org_id, 'orders', 'create', private.site_row_owners(site_id))
  );
CREATE POLICY "Orders: client creates new from cabinet" ON public.orders FOR INSERT TO authenticated
  WITH CHECK (status = 'new' AND source = 'cabinet' AND private.is_client_contact(client_id));
CREATE POLICY "Orders: staff edit" ON public.orders FOR UPDATE TO authenticated
  USING (status IN ('new', 'accepted') AND private.row_in_scope(org_id, 'orders', 'update', private.site_row_owners(site_id)))
  WITH CHECK (private.row_in_scope(org_id, 'orders', 'update', private.site_row_owners(site_id)));
CREATE POLICY "Orders: client edits own new" ON public.orders FOR UPDATE TO authenticated
  USING (status = 'new' AND source = 'cabinet' AND private.is_client_contact(client_id))
  WITH CHECK (status = 'new' AND source = 'cabinet' AND private.is_client_contact(client_id));

CREATE POLICY "Shifts: view in scope or own company" ON public.shifts FOR SELECT TO authenticated
  USING (
    private.row_in_scope(org_id, 'orders', 'view', private.site_row_owners(site_id))
    OR private.is_client_contact(client_id)
  );

-- Ставки смен: ставка исполнителя — только сотрудникам с правом смотреть тарифы.
CREATE POLICY "Shift rates: staff with tariff access" ON public.shift_rates FOR SELECT TO authenticated
  USING (private.client_in_scope(client_id, 'tariffs', 'view'));
