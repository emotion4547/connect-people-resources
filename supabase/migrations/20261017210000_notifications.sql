-- Этап 1, шаг 12: уведомления.
-- ТЗ: раздел 13 (таблица событий, правила, лента).
--
-- Схема: событие в базе → запись в ленту человека (колокольчик в системе) + задания на доставку по
-- внешним каналам (очередь `notification_outbox`). Доставляет очередь edge-функция `deliver-notifications`
-- (MAX, push, email, SMS); пока для email и SMS не выбран провайдер, такие задания помечаются «пропущено» и
-- не теряются: лента в системе остаётся единственным обязательным каналом.

-- ============================================================
-- 1. События
-- ============================================================
CREATE TABLE public.notification_events (
  code text PRIMARY KEY,
  title text NOT NULL,
  -- Каналы по порядку предпочтения. В ленту системы пишется всегда; здесь только внешние.
  channels text[] NOT NULL DEFAULT '{}' CHECK (channels <@ ARRAY['max', 'push', 'email', 'sms']),
  -- first — первый настроенный у человека канал из списка (push, затем MAX, затем SMS); all — все настроенные.
  delivery text NOT NULL DEFAULT 'all' CHECK (delivery IN ('first', 'all')),
  -- Критичные нельзя отключить в профиле и можно слать ночью.
  critical boolean NOT NULL DEFAULT false,
  audience text NOT NULL
);

INSERT INTO public.notification_events (code, title, channels, delivery, critical, audience) VALUES
  ('order_new_cabinet',   'Новый заказ из кабинета',              ARRAY['max'],                 'all',   false, 'менеджер объекта'),
  ('order_urgent',        'Срочный заказ',                        ARRAY['max'],                 'all',   true,  'менеджер, руководитель'),
  ('shift_understaffed',  'Смена не укомплектована',              ARRAY['max'],                 'all',   false, 'менеджер объекта'),
  ('assignment_new',      'Приглашение или назначение на смену',  ARRAY['push', 'max', 'sms'],  'first', false, 'исполнитель'),
  ('shift_reminder',      'Напоминание о смене',                  ARRAY['push', 'max', 'sms'],  'first', false, 'исполнитель'),
  ('unconfirmed_list',    'Не подтвердили выход',                 ARRAY[]::text[],              'all',   false, 'менеджер объекта'),
  ('no_checkin',          'Нет отметки прихода',                  ARRAY['push'],                'all',   true,  'менеджер, бригадир'),
  ('timesheet_sent',      'Табель отправлен на подтверждение',    ARRAY['email'],               'all',   true,  'заказчик'),
  ('timesheet_deadline',  'Скоро автоподтверждение табеля',       ARRAY['email'],               'all',   true,  'заказчик'),
  ('dispute_opened',      'Строка табеля оспорена',               ARRAY['max'],                 'all',   false, 'менеджер объекта'),
  ('document_expiring',   'Истекает документ',                    ARRAY['push'],                'all',   false, 'рекрутер'),
  ('mvd_notify',          'Уведомить МВД',                        ARRAY[]::text[],              'all',   true,  'рекрутер'),
  ('tariff_pending',      'Тариф на согласовании',                ARRAY['max'],                 'all',   false, 'руководитель'),
  ('contract_ending',     'Договор заканчивается',                ARRAY[]::text[],              'all',   false, 'менеджер продаж'),
  ('deduction_pending',   'Удержание ждёт согласования',          ARRAY[]::text[],              'all',   false, 'руководитель'),
  ('staff_task',          'Новая задача',                         ARRAY[]::text[],              'all',   false, 'сотрудник');

-- Часовой пояс для «не беспокоить» и времени напоминаний (организация одна на регион).
INSERT INTO public.setting_definitions
  (key, group_name, label, description, value_type, default_value, nullable, unit, min_value, max_value, allowed_values, levels, needs_confirmation, sort_order)
VALUES
  ('notify.timezone', 'Уведомления', 'Часовой пояс уведомлений', 'По нему считаются «не беспокоить» и время напоминаний исполнителям',
   'text', '"Asia/Yekaterinburg"', false, NULL, NULL, NULL, NULL, ARRAY['org'], false, 65);

-- ============================================================
-- 2. Лента, очередь, контакты, предпочтения
-- ============================================================
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event text NOT NULL REFERENCES public.notification_events(code),
  title text NOT NULL,
  body text,
  -- Куда ведёт уведомление одним нажатием.
  link text,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  -- Для событий по расписанию: одно и то же уведомление одному человеку не создаётся дважды.
  dedup_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX notifications_dedup_key ON public.notifications (user_id, dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX notifications_user_idx ON public.notifications (user_id, is_read, created_at DESC);

CREATE TABLE public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('max', 'push', 'email', 'sms')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  -- Ночью исполнителям не пишем: задание ждёт утра.
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_outbox_pending_idx ON public.notification_outbox (scheduled_at) WHERE status = 'pending';

-- Адреса доставки человека: MAX (идентификатор чата), push (подписка браузера), email (если не тот, что для входа), SMS (телефон).
CREATE TABLE public.notification_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  channel text NOT NULL CHECK (channel IN ('max', 'push', 'email', 'sms')),
  address text NOT NULL CHECK (length(btrim(address)) > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel, address)
);

CREATE TABLE public.notification_prefs (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  event text NOT NULL REFERENCES public.notification_events(code) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, event)
);

-- ============================================================
-- 3. Отправка уведомления
-- ============================================================
CREATE OR REPLACE FUNCTION private.notify_tz(_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public, private
AS $$ SELECT coalesce(public.get_setting(_org_id, 'notify.timezone') #>> '{}', 'Asia/Yekaterinburg') $$;

-- Сейчас в «тихие часы» исполнителей? Если да, возвращает момент, когда они кончатся.
CREATE OR REPLACE FUNCTION private.quiet_until(_org_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public, private
AS $$
DECLARE
  tz text := private.notify_tz(_org_id);
  q_from time := coalesce((public.get_setting(_org_id, 'notify.quiet_from') #>> '{}')::time, time '22:00');
  q_to time := coalesce((public.get_setting(_org_id, 'notify.quiet_to') #>> '{}')::time, time '08:00');
  local_now timestamp := now() AT TIME ZONE tz;
  t time := local_now::time;
  inside boolean;
BEGIN
  inside := CASE WHEN q_from > q_to THEN (t >= q_from OR t < q_to) ELSE (t >= q_from AND t < q_to) END;
  IF NOT inside THEN RETURN now(); END IF;
  RETURN ((CASE WHEN t >= q_from AND q_from > q_to THEN local_now::date + 1 ELSE local_now::date END) + q_to) AT TIME ZONE tz;
END;
$$;

-- Создаёт уведомление человеку: запись в ленте и задания на доставку по его настроенным каналам.
-- Возвращает идентификатор или NULL, если человек отключил это событие или оно уже создавалось (_dedup).
CREATE OR REPLACE FUNCTION private.notify(_org_id uuid, _user_id uuid, _event text, _title text, _body text DEFAULT NULL,
                                          _link text DEFAULT NULL, _dedup text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  ev public.notification_events;
  nid uuid;
  ch text;
  sent_any boolean := false;
  is_worker boolean;
  at_time timestamptz;
  addr_ok boolean;
BEGIN
  IF _user_id IS NULL OR NOT private.is_user_active(_user_id) THEN RETURN NULL; END IF;
  SELECT * INTO ev FROM public.notification_events WHERE code = _event;
  IF NOT FOUND THEN RAISE EXCEPTION 'Неизвестное событие уведомления: %', _event; END IF;
  IF NOT ev.critical AND EXISTS (SELECT 1 FROM public.notification_prefs p WHERE p.user_id = _user_id AND p.event = _event AND NOT p.enabled) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (org_id, user_id, event, title, body, link, dedup_key)
  VALUES (_org_id, _user_id, _event, _title, _body, _link, _dedup)
  ON CONFLICT (user_id, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
  RETURNING id INTO nid;
  IF nid IS NULL THEN RETURN NULL; END IF;

  is_worker := EXISTS (SELECT 1 FROM public.workers w WHERE w.user_id = _user_id);
  at_time := CASE WHEN is_worker AND NOT ev.critical THEN private.quiet_until(_org_id) ELSE now() END;

  FOREACH ch IN ARRAY ev.channels LOOP
    -- Адрес: у email по умолчанию тот, что для входа.
    addr_ok := EXISTS (SELECT 1 FROM public.notification_contacts c WHERE c.user_id = _user_id AND c.channel = ch AND c.is_active)
               OR (ch = 'email' AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _user_id AND u.email IS NOT NULL));
    CONTINUE WHEN NOT addr_ok;
    INSERT INTO public.notification_outbox (org_id, notification_id, user_id, channel, scheduled_at)
    VALUES (_org_id, nid, _user_id, ch, at_time);
    sent_any := true;
    EXIT WHEN ev.delivery = 'first';
  END LOOP;
  RETURN nid;
END;
$$;

-- Получатели
CREATE OR REPLACE FUNCTION private.site_manager_of(_site_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$
  SELECT coalesce(s.site_manager_id, c.sites_manager_id) FROM public.sites s LEFT JOIN public.clients c ON c.id = s.client_id WHERE s.id = _site_id
$$;

CREATE OR REPLACE FUNCTION private.org_directors(_org_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, private
AS $$ SELECT DISTINCT user_id FROM public.user_roles WHERE org_id = _org_id AND role = 'director' $$;

-- ============================================================
-- 4. События, которые возникают сразу
-- ============================================================
-- Новый заказ из кабинета и срочный заказ
CREATE OR REPLACE FUNCTION private.tg_order_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  mgr uuid := private.site_manager_of(NEW.site_id);
  d uuid;
  site_name text;
BEGIN
  SELECT name INTO site_name FROM public.sites WHERE id = NEW.site_id;
  IF NEW.source = 'cabinet' THEN
    PERFORM private.notify(NEW.org_id, mgr, 'order_new_cabinet', 'Новый заказ из кабинета: ' || site_name,
                           NEW.headcount || ' чел. с ' || to_char(NEW.date_from, 'DD.MM'), '/orders/' || NEW.id);
  END IF;
  IF NEW.starts_at IS NOT NULL AND NEW.starts_at - now() < interval '24 hours' THEN
    PERFORM private.notify(NEW.org_id, mgr, 'order_urgent', 'Срочный заказ: ' || site_name, 'Старт меньше чем через 24 часа', '/orders/' || NEW.id);
    FOR d IN SELECT private.org_directors(NEW.org_id) LOOP
      PERFORM private.notify(NEW.org_id, d, 'order_urgent', 'Срочный заказ: ' || site_name, 'Старт меньше чем через 24 часа', '/orders/' || NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_notify AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION private.tg_order_notify();

-- Приглашение или назначение на смену — исполнителю (если он не откликался сам)
CREATE OR REPLACE FUNCTION private.tg_assignment_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  s public.shifts;
  site_name text;
  title text;
BEGIN
  IF NEW.is_reserve OR NEW.status NOT IN ('invited', 'assigned') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;
  -- Отклик исполнителя подтверждается менеджером, но не «приглашение»: тут писать нужно.
  IF NEW.status = 'assigned' AND coalesce(NEW.created_by = NEW.worker_id, false) AND TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  SELECT * INTO s FROM public.shifts WHERE id = NEW.shift_id;
  SELECT name INTO site_name FROM public.sites WHERE id = s.site_id;
  title := CASE NEW.status WHEN 'invited' THEN 'Приглашение на смену' ELSE 'Вас назначили на смену' END;
  PERFORM private.notify(NEW.org_id, NEW.worker_id, 'assignment_new', title,
                         site_name || ', ' || to_char(s.shift_date, 'DD.MM'), '/worker/my-shifts', 'assign:' || NEW.id || ':' || NEW.status);
  RETURN NEW;
END;
$$;

CREATE TRIGGER assignments_notify AFTER INSERT OR UPDATE OF status ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION private.tg_assignment_notify();

-- Табель отправлен заказчику
CREATE OR REPLACE FUNCTION private.tg_timesheet_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  u uuid;
  site_name text;
BEGIN
  IF NEW.status = 'pending' AND OLD.status = 'draft' THEN
    SELECT name INTO site_name FROM public.sites WHERE id = NEW.site_id;
    FOR u IN SELECT user_id FROM public.client_contacts WHERE client_id = NEW.client_id AND user_id IS NOT NULL LOOP
      PERFORM private.notify(NEW.org_id, u, 'timesheet_sent', 'Табель на подтверждении: ' || site_name,
                             'Период ' || to_char(NEW.period_from, 'DD.MM') || ' — ' || to_char(NEW.period_to, 'DD.MM'),
                             '/client/timesheets/' || NEW.id, 'tssent:' || NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER timesheets_notify AFTER UPDATE OF status ON public.timesheets
  FOR EACH ROW EXECUTE FUNCTION private.tg_timesheet_notify();

-- Строка табеля оспорена
CREATE OR REPLACE FUNCTION private.tg_dispute_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  t public.timesheets;
BEGIN
  SELECT * INTO t FROM public.timesheets WHERE id = NEW.timesheet_id;
  PERFORM private.notify(NEW.org_id, private.site_manager_of(t.site_id), 'dispute_opened', 'Заказчик оспорил строку табеля',
                         NEW.reason, '/timesheets/' || NEW.timesheet_id, 'dispute:' || NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER disputes_notify AFTER INSERT ON public.timesheet_disputes FOR EACH ROW EXECUTE FUNCTION private.tg_dispute_notify();

-- Тариф ушёл на согласование
CREATE OR REPLACE FUNCTION private.tg_tariff_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  d uuid;
  cname text;
BEGIN
  IF NEW.status = 'pending' AND OLD.status IS DISTINCT FROM 'pending' THEN
    SELECT name INTO cname FROM public.clients WHERE id = NEW.client_id;
    FOR d IN SELECT private.org_directors(NEW.org_id) LOOP
      PERFORM private.notify(NEW.org_id, d, 'tariff_pending', 'Тариф на согласовании: ' || cname, NULL, '/clients/' || NEW.client_id, 'tariff:' || NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tariffs_notify AFTER UPDATE OF status ON public.tariffs FOR EACH ROW EXECUTE FUNCTION private.tg_tariff_notify();

-- Удержание ждёт согласования руководителя
CREATE OR REPLACE FUNCTION private.tg_accrual_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  d uuid;
BEGIN
  IF NEW.needs_approval AND NEW.status = 'draft' THEN
    FOR d IN SELECT private.org_directors(NEW.org_id) LOOP
      PERFORM private.notify(NEW.org_id, d, 'deduction_pending', 'Удержание ждёт согласования', abs(NEW.amount_worker) || ' ₽', '/accruals', 'ded:' || NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER accruals_notify AFTER INSERT ON public.accruals FOR EACH ROW EXECUTE FUNCTION private.tg_accrual_notify();

-- Задачи сотрудников (МВД, сроки документов): ответственному или всем с нужной ролью
CREATE OR REPLACE FUNCTION private.tg_staff_task_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  u uuid;
  ev text := CASE WHEN NEW.kind LIKE 'mvd_%' THEN 'mvd_notify' WHEN NEW.kind LIKE 'document_expires_%' THEN 'document_expiring' ELSE 'staff_task' END;
BEGIN
  IF NEW.assignee_id IS NOT NULL THEN
    PERFORM private.notify(NEW.org_id, NEW.assignee_id, ev, NEW.title, 'Срок: ' || to_char(NEW.due_date, 'DD.MM.YYYY'), '/hiring/today', 'task:' || NEW.id);
  ELSIF NEW.assignee_role IS NOT NULL THEN
    FOR u IN SELECT DISTINCT user_id FROM public.user_roles WHERE org_id = NEW.org_id AND role = NEW.assignee_role LOOP
      PERFORM private.notify(NEW.org_id, u, ev, NEW.title, 'Срок: ' || to_char(NEW.due_date, 'DD.MM.YYYY'), '/hiring/today', 'task:' || NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER staff_tasks_notify AFTER INSERT ON public.staff_tasks FOR EACH ROW EXECUTE FUNCTION private.tg_staff_task_notify();

-- ============================================================
-- 5. События по расписанию
-- ============================================================
-- Вызывается по расписанию раз в 5–10 минут (cron). Каждое уведомление создаётся один раз (dedup).
CREATE OR REPLACE FUNCTION private.run_notification_jobs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  n integer := 0;
  r record;
  rid uuid;
  reminder_t time;
  confirm_t time;
BEGIN
  -- За 24 часа до начала смена не укомплектована — менеджеру объекта
  FOR r IN
    SELECT s.id, s.org_id, s.site_id, s.shift_date, s.headcount, si.name AS site_name,
           (SELECT count(*) FROM public.assignments a WHERE a.shift_id = s.id AND NOT a.is_reserve AND a.status IN ('assigned', 'confirmed', 'on_site', 'worked')) AS taken
    FROM public.shifts s JOIN public.sites si ON si.id = s.site_id
    WHERE s.status IN ('open', 'staffed') AND s.published_at IS NOT NULL AND s.start_at > now() AND s.start_at <= now() + interval '24 hours'
  LOOP
    IF r.taken < r.headcount THEN
      rid := private.notify(r.org_id, private.site_manager_of(r.site_id), 'shift_understaffed', 'Смена не укомплектована: ' || r.site_name,
                            to_char(r.shift_date, 'DD.MM') || ': нужно ' || r.headcount || ', назначено ' || r.taken, '/planning', 'understaffed:' || r.id);
      IF rid IS NOT NULL THEN n := n + 1; END IF;
    END IF;
  END LOOP;

  -- Напоминание исполнителю накануне (по умолчанию в 18:00 по времени объекта) с просьбой подтвердить выход
  FOR r IN
    SELECT a.id AS aid, a.org_id, a.worker_id, s.shift_date, s.client_id, s.site_id, si.name AS site_name, si.timezone,
           coalesce((public.get_setting(a.org_id, 'notify.worker_reminder_time', s.shift_date, s.client_id, s.site_id) #>> '{}')::time, time '18:00') AS t_rem
    FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id JOIN public.sites si ON si.id = s.site_id
    WHERE a.status = 'assigned' AND NOT a.is_reserve AND s.status IN ('open', 'staffed')
  LOOP
    IF r.shift_date = ((now() AT TIME ZONE r.timezone)::date + 1) AND (now() AT TIME ZONE r.timezone)::time >= r.t_rem THEN
      rid := private.notify(r.org_id, r.worker_id, 'shift_reminder', 'Завтра смена: подтвердите выход',
                            r.site_name || ', ' || to_char(r.shift_date, 'DD.MM'), '/worker/my-shifts', 'reminder:' || r.aid);
      IF rid IS NOT NULL THEN n := n + 1; END IF;
    END IF;
  END LOOP;

  -- После срока подтверждения (по умолчанию 21:00) менеджеру — список не подтвердивших на завтра
  FOR r IN
    SELECT private.site_manager_of(s.site_id) AS mgr, s.org_id, s.shift_date, si.timezone, count(*) AS cnt,
           min(coalesce((public.get_setting(a.org_id, 'notify.confirm_deadline_time', s.shift_date, s.client_id, s.site_id) #>> '{}')::time, time '21:00')) AS t_conf
    FROM public.assignments a JOIN public.shifts s ON s.id = a.shift_id JOIN public.sites si ON si.id = s.site_id
    WHERE a.status = 'assigned' AND NOT a.is_reserve AND s.status IN ('open', 'staffed')
    GROUP BY private.site_manager_of(s.site_id), s.org_id, s.shift_date, si.timezone
  LOOP
    IF r.mgr IS NOT NULL AND r.shift_date = ((now() AT TIME ZONE r.timezone)::date + 1) AND (now() AT TIME ZONE r.timezone)::time >= r.t_conf THEN
      rid := private.notify(r.org_id, r.mgr, 'unconfirmed_list', 'Не подтвердили выход на завтра: ' || r.cnt,
                            'Позвоните исполнителям из списка', '/planning', 'unconf:' || r.mgr || ':' || r.shift_date);
      IF rid IS NOT NULL THEN n := n + 1; END IF;
    END IF;
  END LOOP;

  -- Через 15 минут после начала нет отметки — менеджеру и бригадиру на этой смене
  FOR r IN
    SELECT al.assignment_id, al.shift_id, al.site_id, al.org_id, al.worker_id, al.minutes_late, w.full_name
    FROM public.attendance_alerts al JOIN public.workers w ON w.user_id = al.worker_id
  LOOP
    rid := private.notify(r.org_id, private.site_manager_of(r.site_id), 'no_checkin', 'Нет отметки: ' || r.full_name,
                          'Опаздывает на ' || r.minutes_late || ' мин', '/timesheets', 'nocheckin:' || r.assignment_id);
    IF rid IS NOT NULL THEN n := n + 1; END IF;
    FOR rid IN SELECT b.worker_id FROM public.assignments b JOIN public.workers bw ON bw.user_id = b.worker_id AND bw.is_brigadier
               WHERE b.shift_id = r.shift_id AND b.worker_id <> r.worker_id AND b.status IN ('assigned', 'confirmed', 'on_site') LOOP
      PERFORM private.notify(r.org_id, rid, 'no_checkin', 'Нет отметки: ' || r.full_name, 'Опаздывает на ' || r.minutes_late || ' мин',
                             '/worker/my-shifts', 'nocheckin:' || r.assignment_id);
    END LOOP;
  END LOOP;

  -- За сутки до автоподтверждения табеля — заказчику
  FOR r IN
    SELECT t.id, t.org_id, t.client_id, si.name AS site_name
    FROM public.timesheets t JOIN public.sites si ON si.id = t.site_id
    WHERE t.status IN ('pending', 'disputed') AND t.confirm_deadline > now() AND t.confirm_deadline <= now() + interval '24 hours'
  LOOP
    FOR rid IN SELECT user_id FROM public.client_contacts WHERE client_id = r.client_id AND user_id IS NOT NULL LOOP
      PERFORM private.notify(r.org_id, rid, 'timesheet_deadline', 'Табель подтвердится сам через сутки: ' || r.site_name,
                             'Проверьте строки и оспорьте спорные', '/client/timesheets/' || r.id, 'tsdeadline:' || r.id);
      n := n + 1;
    END LOOP;
  END LOOP;

  -- За 30 дней до конца договора — менеджеру продаж
  FOR r IN
    SELECT c.id, c.org_id, c.number, c.valid_until, cl.name AS client_name, cl.sales_manager_id
    FROM public.contracts c JOIN public.clients cl ON cl.id = c.client_id
    WHERE c.status = 'active' AND c.valid_until IS NOT NULL AND c.valid_until BETWEEN current_date AND current_date + 30
  LOOP
    rid := private.notify(r.org_id, r.sales_manager_id, 'contract_ending', 'Договор заканчивается: ' || r.client_name,
                          '№ ' || r.number || ' до ' || to_char(r.valid_until, 'DD.MM.YYYY'), '/clients', 'contract:' || r.id);
    IF rid IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;

  RETURN n;
END;
$$;

-- ============================================================
-- 6. Работа с лентой и контактами
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_notifications_read(_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE
  n integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Недостаточно прав' USING ERRCODE = '42501'; END IF;
  UPDATE public.notifications SET is_read = true, read_at = now()
   WHERE user_id = auth.uid() AND NOT is_read AND (_ids IS NULL OR id = ANY (_ids));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Очередь для доставщика: берёт пачку готовых заданий вместе с текстом и адресом. Выполнять может только служебная роль:
-- право на вызов выдано ей одной (внутри SECURITY DEFINER роль вызывающего уже не видна, поэтому проверка — правом EXECUTE).
CREATE OR REPLACE FUNCTION public.claim_outbox(_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, channel text, user_id uuid, title text, body text, link text, address text, attempts integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT o.id FROM public.notification_outbox o
    WHERE o.status = 'pending' AND o.scheduled_at <= now() AND o.attempts < 5
    ORDER BY o.scheduled_at LIMIT _limit FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.notification_outbox o SET attempts = o.attempts + 1 FROM picked WHERE o.id = picked.id RETURNING o.*
  )
  SELECT u.id, u.channel, u.user_id, n.title, n.body, n.link,
         coalesce((SELECT string_agg(c.address, E'\n') FROM public.notification_contacts c WHERE c.user_id = u.user_id AND c.channel = u.channel AND c.is_active),
                  CASE WHEN u.channel = 'email' THEN (SELECT au.email FROM auth.users au WHERE au.id = u.user_id) END),
         u.attempts
  FROM upd u JOIN public.notifications n ON n.id = u.notification_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_outbox(_id uuid, _status text, _error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  IF _status NOT IN ('sent', 'failed', 'skipped') THEN RAISE EXCEPTION 'Неизвестный статус' USING ERRCODE = '22023'; END IF;
  -- Ошибка не окончательная, пока есть попытки: задание вернётся в очередь через 5 минут.
  UPDATE public.notification_outbox
     SET status = CASE WHEN _status = 'failed' AND attempts < 5 THEN 'pending' ELSE _status END,
         scheduled_at = CASE WHEN _status = 'failed' AND attempts < 5 THEN now() + interval '5 minutes' ELSE scheduled_at END,
         last_error = _error, sent_at = CASE WHEN _status = 'sent' THEN now() END
   WHERE id = _id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.claim_outbox(integer), public.finish_outbox(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox(integer), public.finish_outbox(uuid, text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION private.notify(uuid, uuid, text, text, text, text, text), private.run_notification_jobs(),
  private.quiet_until(uuid), private.notify_tz(uuid), private.site_manager_of(uuid), private.org_directors(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.notify(uuid, uuid, text, text, text, text, text), private.run_notification_jobs(),
  private.quiet_until(uuid), private.notify_tz(uuid), private.site_manager_of(uuid), private.org_directors(uuid) TO service_role;

-- ============================================================
-- 7. Доступ
-- ============================================================
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_events, public.notifications, public.notification_outbox, public.notification_contacts, public.notification_prefs
  FROM anon, authenticated;
GRANT SELECT ON public.notification_events, public.notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_contacts, public.notification_prefs TO authenticated;
GRANT ALL ON public.notification_events, public.notifications, public.notification_outbox, public.notification_contacts, public.notification_prefs TO service_role;

CREATE POLICY "Events: everyone reads" ON public.notification_events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Notifications: own" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Contacts: own read" ON public.notification_contacts FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Contacts: own add" ON public.notification_contacts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND private.is_org_member(org_id));
CREATE POLICY "Contacts: own edit" ON public.notification_contacts FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Contacts: own delete" ON public.notification_contacts FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Prefs: own read" ON public.notification_prefs FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Prefs: own add" ON public.notification_prefs FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Prefs: own edit" ON public.notification_prefs FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Prefs: own delete" ON public.notification_prefs FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Расписание уведомлений вызывается доставщиком (edge-функция) перед разбором очереди; отдельная обёртка в public,
-- потому что PostgREST вызывает только функции этой схемы. Доступна только служебной роли.
CREATE OR REPLACE FUNCTION public.run_notification_jobs_public()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, private
AS $$ SELECT private.run_notification_jobs() $$;

REVOKE EXECUTE ON FUNCTION public.run_notification_jobs_public() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_notification_jobs_public() TO service_role;
