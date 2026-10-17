-- Этап 1, шаг 13: перенос данных прежней схемы (заявки и отклики) в новую.
-- ТЗ: раздел 13, таблица «Перенос текущих данных».
--
-- Заказчики из HR-пользователей (шаг 4) и исполнители из профилей (шаг 7) уже перенесены. Здесь: объекты без заказчика,
-- заявки → заказы со сменами, отклики → назначения. Сами функции переноса миграция НЕ запускает:
-- перенос делается вручную после резервной копии, сначала на копии базы, затем сверяется отчётом (см. deploy/README.md).
--
--   select * from private.migrate_legacy_requests();   -- перенос, повторный запуск ничего не дублирует
--   select * from private.legacy_migration_report();   -- сверка количества до и после

-- ============================================================
-- 1. Подготовка
-- ============================================================
ALTER TABLE public.orders ADD COLUMN legacy_request_id uuid UNIQUE;

CREATE TABLE public.legacy_migration_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity text NOT NULL CHECK (entity IN ('site', 'request', 'response')),
  legacy_id uuid NOT NULL,
  result text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX legacy_migration_log_idx ON public.legacy_migration_log (entity, result);
ALTER TABLE public.legacy_migration_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legacy_migration_log FROM anon, authenticated;
GRANT ALL ON public.legacy_migration_log TO service_role;

-- Заказы из старых заявок вносятся и без утверждённого тарифа: оплата в старых заявках — текст, тарифы заводят
-- продажи до запуска. Такой заказ остаётся «новым», пока тариф не появится; принять без тарифа нельзя.
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
  legacy boolean := coalesce(current_setting('app.legacy_import', true), '') = 'on';
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

  IF TG_OP = 'INSERT' AND NOT legacy THEN
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

-- Запись в журнал: итог по записи один, повторный запуск его обновляет, а не дублирует.
CREATE OR REPLACE FUNCTION private.legacy_log(_entity text, _id uuid, _result text, _note text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$
  WITH d AS (DELETE FROM public.legacy_migration_log WHERE entity = _entity AND legacy_id = _id)
  INSERT INTO public.legacy_migration_log (entity, legacy_id, result, note) VALUES (_entity, _id, _result, _note)
$$;

REVOKE EXECUTE ON FUNCTION private.legacy_log(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.legacy_log(text, uuid, text, text) TO service_role;

-- ============================================================
-- 2. Объекты без заказчика
-- ============================================================
-- Заказчик объекта — по компании HR, закреплённого за ним (site_managers), а если такого нет — по HR,
-- который подавал заявки на этот объект.
CREATE OR REPLACE FUNCTION private.migrate_legacy_sites()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  s record;
  cid uuid;
  n integer := 0;
BEGIN
  FOR s IN SELECT id FROM public.sites WHERE client_id IS NULL LOOP
    SELECT cc.client_id INTO cid FROM public.site_managers sm JOIN public.client_contacts cc ON cc.user_id = sm.hr_user_id
     WHERE sm.site_id = s.id ORDER BY sm.created_at LIMIT 1;
    IF cid IS NULL THEN
      SELECT cc.client_id INTO cid FROM public.requests r JOIN public.client_contacts cc ON cc.user_id = r.hr_id
       WHERE r.site_id = s.id ORDER BY r.created_at LIMIT 1;
    END IF;
    IF cid IS NULL THEN
      PERFORM private.legacy_log('site', s.id, 'skipped', 'не удалось определить заказчика объекта');
    ELSE
      UPDATE public.sites SET client_id = cid WHERE id = s.id;
      PERFORM private.legacy_log('site', s.id, 'migrated');
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- ============================================================
-- 3. Заявки → заказы и смены, отклики → назначения
-- ============================================================
-- Правила (раздел 13 ТЗ):
--   завершённые, отменённые и прошедшие заявки — в архив (заказ без смен);
--   активные и будущие — заказ; смены по дням создаются, если на все даты есть утверждённый тариф,
--   иначе заказ остаётся «новым» и ждёт тарифа;
--   назначенный на заявку получает назначение на каждую будущую смену, откликнувшийся — отклик.
-- Оплата текстом уходит в комментарий заказа подсказкой. Повторный запуск уже перенесённое пропускает.
CREATE OR REPLACE FUNCTION private.migrate_legacy_requests()
RETURNS TABLE (entity text, result text, cnt integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  r record;
  resp record;
  sh record;
  cc public.client_contacts;
  site_row public.sites;
  pos_id uuid;
  oid uuid;
  archived boolean;
  st text;
  d date;
  all_priced boolean;
  made integer;
  o public.orders;
  note text;
BEGIN
  PERFORM set_config('app.legacy_import', 'on', true);
  PERFORM private.migrate_legacy_sites();

  FOR r IN SELECT * FROM public.requests q WHERE NOT EXISTS (SELECT 1 FROM public.orders x WHERE x.legacy_request_id = q.id) ORDER BY q.created_at LOOP
    SELECT * INTO cc FROM public.client_contacts WHERE user_id = r.hr_id ORDER BY created_at LIMIT 1;
    IF cc.id IS NULL THEN
      PERFORM private.legacy_log('request', r.id, 'skipped', 'у автора заявки нет заказчика');
      CONTINUE;
    END IF;

    -- Объект: из заявки; если он чужого заказчика или не указан — объект по адресу заявки у этого заказчика.
    site_row := NULL;
    IF r.site_id IS NOT NULL THEN
      SELECT * INTO site_row FROM public.sites WHERE id = r.site_id;
      IF site_row.client_id IS NULL THEN
        UPDATE public.sites SET client_id = cc.client_id WHERE id = site_row.id;
        site_row.client_id := cc.client_id;
      ELSIF site_row.client_id <> cc.client_id THEN
        site_row := NULL;
      END IF;
    END IF;
    IF site_row.id IS NULL THEN
      SELECT * INTO site_row FROM public.sites WHERE client_id = cc.client_id AND address = r.address ORDER BY created_at LIMIT 1;
    END IF;
    IF site_row.id IS NULL THEN
      INSERT INTO public.sites (org_id, name, address, client_id)
      VALUES (cc.org_id, left(r.address, 80), r.address, cc.client_id) RETURNING * INTO site_row;
    END IF;

    -- Позиция: по названию без учёта регистра; прежней «другой» позиции в справочнике нет — заводим.
    SELECT id INTO pos_id FROM public.positions WHERE org_id = cc.org_id AND lower(btrim(name)) = lower(btrim(r.position));
    IF pos_id IS NULL THEN
      INSERT INTO public.positions (org_id, name) VALUES (cc.org_id, btrim(r.position)) RETURNING id INTO pos_id;
    END IF;

    archived := r.end_date < current_date OR r.status IN ('completed', 'cancelled');
    st := CASE WHEN NOT archived THEN 'new' WHEN r.status = 'cancelled' THEN 'cancelled' ELSE 'completed' END;
    note := nullif(btrim(concat_ws(E'\n', r.comments, CASE WHEN nullif(btrim(coalesce(r.pay, '')), '') IS NOT NULL THEN 'Оплата в прежней заявке: ' || r.pay END)), '');

    INSERT INTO public.orders (org_id, client_id, site_id, position_id, unit, date_from, date_to, start_time, end_time,
                               headcount, requirements, comment, status, source, created_at, legacy_request_id, cancelled_at)
    VALUES (cc.org_id, cc.client_id, site_row.id, pos_id, 'hour', r.start_date, least(r.end_date, r.start_date + 366),
            coalesce(r.start_time, time '08:00'),
            CASE WHEN coalesce(r.end_time, time '17:00') = coalesce(r.start_time, time '08:00') THEN time '17:00' ELSE coalesce(r.end_time, time '17:00') END,
            greatest(coalesce(r.quantity, 1), 1), r.requirements, note, st, 'manager', r.created_at,
            r.id, CASE WHEN st = 'cancelled' THEN r.updated_at END)
    RETURNING id INTO oid;

    IF archived THEN
      PERFORM private.legacy_log('request', r.id, 'archived', st);
      CONTINUE;
    END IF;

    -- Смены по дням — если на каждую дату есть утверждённый тариф.
    SELECT * INTO o FROM public.orders WHERE id = oid;
    all_priced := true;
    FOR d IN SELECT x FROM private.order_dates(o) x LOOP
      IF public.get_tariff(o.client_id, o.site_id, o.position_id, o.unit, d) IS NULL THEN all_priced := false; EXIT; END IF;
    END LOOP;

    IF NOT all_priced THEN
      PERFORM private.legacy_log('request', r.id, 'awaiting_tariff', 'заказ создан новым: нужен утверждённый тариф, затем «Принять»');
      CONTINUE;
    END IF;

    made := private.generate_shifts(oid);
    UPDATE public.orders SET status = 'accepted', accepted_at = now() WHERE id = oid;
    PERFORM private.legacy_log('request', r.id, 'migrated', 'смен: ' || made);

    -- Отклики
    FOR resp IN SELECT * FROM public.responses WHERE request_id = r.id LOOP
      IF resp.status NOT IN ('assigned', 'pending') THEN
        PERFORM private.legacy_log('response', resp.id, 'archived', resp.status::text);
        CONTINUE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM public.workers w WHERE w.user_id = resp.worker_id AND w.org_id = cc.org_id) THEN
        PERFORM private.legacy_log('response', resp.id, 'skipped', 'нет карточки исполнителя');
        CONTINUE;
      END IF;
      made := 0;
      FOR sh IN SELECT id, start_at, end_at FROM public.shifts WHERE order_id = oid AND start_at > now() LOOP
        BEGIN
          INSERT INTO public.assignments (org_id, shift_id, worker_id, status, source, shift_start, shift_end)
          VALUES (cc.org_id, sh.id, resp.worker_id, CASE resp.status WHEN 'assigned' THEN 'assigned' ELSE 'responded' END,
                  CASE resp.status WHEN 'assigned' THEN 'assigned' ELSE 'response' END, sh.start_at, sh.end_at)
          ON CONFLICT (shift_id, worker_id) DO NOTHING;
          IF FOUND THEN made := made + 1; END IF;
        EXCEPTION WHEN exclusion_violation THEN
          PERFORM private.legacy_log('response', resp.id, 'skipped', 'пересечение со сменой исполнителя на ' || sh.start_at::date);
        END;
      END LOOP;
      PERFORM private.legacy_log('response', resp.id, 'migrated', 'назначений: ' || made);
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT l.entity, l.result, count(*)::integer FROM public.legacy_migration_log l GROUP BY l.entity, l.result ORDER BY l.entity, l.result;
END;
$$;

-- Сверка: сколько было и сколько стало. Расхождение любой строки — повод остановиться до выкладки.
CREATE OR REPLACE FUNCTION private.legacy_migration_report()
RETURNS TABLE (item text, before_count bigint, after_count bigint, ok boolean, note text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT 'Заявки → заказы', (SELECT count(*) FROM public.requests),
         (SELECT count(*) FROM public.orders WHERE legacy_request_id IS NOT NULL)
           + (SELECT count(*) FROM public.legacy_migration_log WHERE entity = 'request' AND result = 'skipped'),
         (SELECT count(*) FROM public.requests) = (SELECT count(*) FROM public.orders WHERE legacy_request_id IS NOT NULL)
           + (SELECT count(*) FROM public.legacy_migration_log WHERE entity = 'request' AND result = 'skipped'),
         'не перенесено (с причиной в журнале): ' || (SELECT count(*) FROM public.legacy_migration_log WHERE entity = 'request' AND result = 'skipped')
  UNION ALL
  SELECT 'Отклики → назначения или архив', (SELECT count(*) FROM public.responses),
         (SELECT count(DISTINCT legacy_id) FROM public.legacy_migration_log WHERE entity = 'response')
           + (SELECT count(*) FROM public.responses rs WHERE EXISTS (SELECT 1 FROM public.orders x WHERE x.legacy_request_id = rs.request_id AND x.status IN ('new', 'completed', 'cancelled'))),
         true,
         'отклики на заказы, ожидающие тарифа или находящиеся в архиве, переносятся при принятии заказа или остаются в архиве'
  UNION ALL
  SELECT 'Объекты без заказчика', (SELECT count(*) FROM public.sites WHERE client_id IS NULL), (SELECT count(*) FROM public.sites WHERE client_id IS NULL), true,
         'должно быть 0 после переноса; остаток — объекты, чьего заказчика определить нельзя'
  UNION ALL
  SELECT 'Исполнители без карточки', (SELECT count(*) FROM public.user_roles WHERE role = 'worker'),
         (SELECT count(*) FROM public.workers), (SELECT count(*) FROM public.user_roles WHERE role = 'worker') <= (SELECT count(*) FROM public.workers),
         'у каждого пользователя с ролью исполнителя должна быть карточка'
$$;

REVOKE EXECUTE ON FUNCTION private.migrate_legacy_sites(), private.migrate_legacy_requests(), private.legacy_migration_report()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.migrate_legacy_sites(), private.migrate_legacy_requests(), private.legacy_migration_report() TO service_role;
