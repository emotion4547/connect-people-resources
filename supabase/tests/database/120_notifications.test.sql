-- Шаг 12: уведомления.
-- Событие создаёт запись в ленте человека и задания на внешние каналы; исполнителям ночью не пишем;
-- некритичные события можно отключить; события по расписанию создаются один раз.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(39);

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'cu@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 4) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'site_manager' where user_id = '5c000000-0000-0000-0000-0000000000c1';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
update public.user_roles set role = 'client_admin' where user_id = 'c0000000-0000-0000-0000-00000000000c';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта 1', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');

insert into public.clients (id, org_id, name, sales_manager_id, sites_manager_id) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1');
insert into public.client_contacts (org_id, client_id, full_name, user_id, cabinet_role)
  values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Кабинет 1', 'c0000000-0000-0000-0000-00000000000c', 'client_admin');
insert into public.sites (id, name, client_id, site_manager_id, status, latitude, longitude, checkin_method) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.7682, 55.097, 'geo');
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 30, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
update public.workers set tax_status = 'self_employed' where user_id in (select pg_temp.w(i) from generate_series(1, 4) i);
update public.workers set is_brigadier = true where user_id = pg_temp.w(4);
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from generate_series(1, 4) i, public.positions p
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';
-- Каналы: у директора MAX; у W1 MAX и SMS (push нет); у W2 только SMS
insert into public.notification_contacts (org_id, user_id, channel, address) values
  (private.default_org_id(), 'd1000000-0000-0000-0000-00000000000d', 'max', '1001'),
  (private.default_org_id(), pg_temp.w(1), 'max', '2001'),
  (private.default_org_id(), pg_temp.w(1), 'sms', '+79000000001'),
  (private.default_org_id(), pg_temp.w(2), 'sms', '+79000000002');

select is((select count(*)::int from public.notification_events), 16, 'В справочнике 16 событий');

-- ------------------------------------------------------------
-- Заказ из кабинета и срочный заказ
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, source, break_minutes)
  select 'a1000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001',
         '51e00000-0000-0000-0000-000000000001', p.id, current_date, current_date, '08:00', '17:00', 3, 'cabinet', 60
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
reset role;
select is((select count(*)::int from public.notifications where user_id = '5c000000-0000-0000-0000-0000000000c1' and event = 'order_new_cabinet'), 1,
          'Менеджер объекта получил уведомление о заказе из кабинета');
select is((select link from public.notifications where event = 'order_new_cabinet'), '/orders/a1000000-0000-0000-0000-000000000001', 'Уведомление ведёт на заказ');
select is((select count(*)::int from public.notifications where event = 'order_urgent'), 2, 'Срочный заказ: уведомлены менеджер и руководитель');
select is((select channel || '/' || status from public.notification_outbox where user_id = 'd1000000-0000-0000-0000-00000000000d'), 'max/pending',
          'Руководителю задание в MAX');
select is((select count(*)::int from public.notification_outbox where user_id = '5c000000-0000-0000-0000-0000000000c1'), 0, 'У менеджера MAX не настроен — только лента');

-- ------------------------------------------------------------
-- Назначение: канал «первый настроенный»
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select public.accept_order('a1000000-0000-0000-0000-000000000001');
select public.assign_workers((select array_agg(id) from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001'), array[pg_temp.w(1), pg_temp.w(2)]);
reset role;
select is((select count(*)::int from public.notifications where event = 'assignment_new'), 2, 'Назначенные исполнители уведомлены');
select is((select channel from public.notification_outbox where user_id = pg_temp.w(1)), 'max', 'W1: порядок push, MAX, SMS — выбран MAX (push не настроен), SMS не нужен');
select is((select channel from public.notification_outbox where user_id = pg_temp.w(2)), 'sms', 'W2: настроен только SMS');
select is((select count(*)::int from public.notification_outbox where user_id = pg_temp.w(1)), 1, 'Дублирующих заданий нет');

-- ------------------------------------------------------------
-- Тихие часы
-- ------------------------------------------------------------
insert into public.org_settings (org_id, key, value) values
  (private.default_org_id(), 'notify.quiet_from', '"00:00"'), (private.default_org_id(), 'notify.quiet_to', '"23:59"');
select ok(private.quiet_until(private.default_org_id()) > now() or extract(hour from now() at time zone 'Asia/Yekaterinburg') = 23, 'Сейчас тихие часы: ждать до их окончания');
select private.notify(private.default_org_id(), pg_temp.w(1), 'shift_reminder', 'Тест тихих часов');
select private.notify(private.default_org_id(), pg_temp.w(1), 'no_checkin', 'Срочное');
select ok((select scheduled_at > now() from public.notification_outbox o join public.notifications n on n.id = o.notification_id where n.title = 'Тест тихих часов')
          or extract(hour from now() at time zone 'Asia/Yekaterinburg') = 23, 'Обычное уведомление исполнителю ночью откладывается');
-- no_checkin шлёт только push, у W1 push нет; проверим критичность отдельно: push-подписка
insert into public.notification_contacts (org_id, user_id, channel, address) values (private.default_org_id(), pg_temp.w(1), 'push', '{"endpoint":"x"}');
select private.notify(private.default_org_id(), pg_temp.w(1), 'no_checkin', 'Срочное 2');
select ok((select scheduled_at <= now() from public.notification_outbox o join public.notifications n on n.id = o.notification_id where n.title = 'Срочное 2'),
          'Критичное уведомление идёт сразу даже в тихие часы');
delete from public.org_settings where key in ('notify.quiet_from', 'notify.quiet_to');

-- ------------------------------------------------------------
-- Лента и предпочтения
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select is((select count(*)::int from public.notifications where user_id <> auth.uid()), 0, 'Человек видит только свою ленту');
select ok((select count(*)::int from public.notifications) >= 1, 'и свою видит');
select is(public.mark_notifications_read(), (select count(*)::int from public.notifications where not is_read), 'Отметить всё прочитанным: число совпадает');
select is((select count(*)::int from public.notifications where not is_read), 0, 'Непрочитанных не осталось');
select throws_ok($$insert into public.notifications (org_id, user_id, event, title) values (private.default_org_id(), auth.uid(), 'staff_task', 'x')$$, '42501', null, 'Создавать уведомления из браузера нельзя');

set local request.jwt.claim.sub = '77000003-0000-0000-0000-000000000000';
insert into public.notification_prefs (event, enabled) values ('assignment_new', false);
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select public.assign_worker((select id from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001'), pg_temp.w(3));
reset role;
select is((select count(*)::int from public.notifications where user_id = pg_temp.w(3)), 0, 'Отключённое в профиле событие не создаётся');
insert into public.notification_prefs (user_id, event, enabled) values ('c0000000-0000-0000-0000-00000000000c', 'timesheet_sent', false);
select isnt(private.notify(private.default_org_id(), 'c0000000-0000-0000-0000-00000000000c', 'timesheet_sent', 'Критичное'), null, 'Критичное событие отключить нельзя');
select is((select channel from public.notification_outbox o join public.notifications n on n.id = o.notification_id where n.title = 'Критичное'), 'email',
          'Email берётся из учётной записи, если отдельный адрес не задан');
select throws_ok($$select private.notify(private.default_org_id(), pg_temp.w(1), 'unknown_event', 'x')$$, 'P0001', null, 'Неизвестное событие не создаётся');
select is(private.notify(private.default_org_id(), pg_temp.w(1), 'staff_task', 'Один раз', null, null, 'k1') is not null, true, 'Событие с ключом создаётся');
select is(private.notify(private.default_org_id(), pg_temp.w(1), 'staff_task', 'Один раз', null, null, 'k1'), null, 'и повторно с тем же ключом — нет');

-- ------------------------------------------------------------
-- События по расписанию
-- ------------------------------------------------------------
update public.shifts set headcount = 5, start_at = now() + interval '5 hours', end_at = now() + interval '13 hours',
       shift_date = (now() at time zone (select timezone from public.sites where id = '51e00000-0000-0000-0000-000000000001'))::date
 where order_id = 'a1000000-0000-0000-0000-000000000001';
update public.assignments set shift_start = s.start_at, shift_end = s.end_at from public.shifts s where s.id = assignments.shift_id;
select private.run_notification_jobs();
select is((select count(*)::int from public.notifications where event = 'shift_understaffed'), 1, 'Смена за сутки не укомплектована: менеджер уведомлён');
select private.run_notification_jobs();
select is((select count(*)::int from public.notifications where event = 'shift_understaffed'), 1, 'Повторный запуск дубликат не создаёт');

-- Напоминание и список не подтвердивших: смена «завтра», сроки в настройках сдвинуты на 00:00
insert into public.org_settings (org_id, key, value) values
  (private.default_org_id(), 'notify.worker_reminder_time', '"00:00"'), (private.default_org_id(), 'notify.confirm_deadline_time', '"00:00"');
update public.shifts set shift_date = (now() at time zone (select timezone from public.sites where id = '51e00000-0000-0000-0000-000000000001'))::date + 1
 where order_id = 'a1000000-0000-0000-0000-000000000001';
select private.run_notification_jobs();
select is((select count(*)::int from public.notifications where event = 'shift_reminder' and title like 'Завтра%'), 3, 'Накануне напоминание получили все трое назначенных');
select is((select count(*)::int from public.notifications where event = 'unconfirmed_list'), 1, 'Менеджеру — список не подтвердивших выход');

-- Нет отметки через 15 минут: менеджер и бригадир
update public.shifts set start_at = now() - interval '30 minutes', end_at = now() + interval '7 hours', shift_date = current_date
 where order_id = 'a1000000-0000-0000-0000-000000000001';
update public.assignments set shift_start = s.start_at, shift_end = s.end_at, status = 'confirmed' from public.shifts s where s.id = assignments.shift_id;
update public.assignments set status = 'confirmed' where worker_id = pg_temp.w(3);
insert into public.assignments (org_id, shift_id, worker_id, status, source, shift_start, shift_end)
  select private.default_org_id(), s.id, pg_temp.w(4), 'confirmed', 'assigned', s.start_at, s.end_at from public.shifts s where s.order_id = 'a1000000-0000-0000-0000-000000000001';
select private.run_notification_jobs();
select ok((select count(*)::int from public.notifications where event = 'no_checkin' and user_id = '5c000000-0000-0000-0000-0000000000c1') >= 1, 'Менеджеру — сигнал о неотмеченном');
select ok(exists (select 1 from public.notifications where event = 'no_checkin' and user_id = pg_temp.w(4)), 'Бригадиру тоже');

-- Табель на подтверждение, тариф на согласование, договор
insert into public.timesheets (id, org_id, site_id, client_id, period_from, period_to)
  values ('7a000000-0000-0000-0000-000000000001', private.default_org_id(), '51e00000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', current_date, current_date);
update public.timesheets set status = 'pending', confirm_deadline = now() + interval '10 hours' where id = '7a000000-0000-0000-0000-000000000001';
select is((select link from public.notifications where event = 'timesheet_sent' and title like 'Табель на подтверждении%'), '/client/timesheets/7a000000-0000-0000-0000-000000000001',
          'Заказчик уведомлён о табеле и ссылка ведёт в его кабинет');
select private.run_notification_jobs();
select is((select count(*)::int from public.notifications where event = 'timesheet_deadline'), 1, 'За сутки до автоподтверждения заказчик предупреждён');

set local app.tariff_internal = 'on';
update public.tariffs set status = 'pending' where client_id = 'c1000000-0000-0000-0000-000000000001';
set local app.tariff_internal = 'off';
select ok(exists (select 1 from public.notifications where event = 'tariff_pending' and user_id = 'd1000000-0000-0000-0000-00000000000d'), 'Руководитель уведомлён о тарифе на согласовании');

insert into public.contracts (org_id, client_id, number, signed_on, valid_until, status)
  values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Д-1', current_date - 300, current_date + 10, 'active');
select private.run_notification_jobs();
select ok(exists (select 1 from public.notifications where event = 'contract_ending' and user_id = '51000000-0000-0000-0000-000000000001'), 'Менеджер продаж предупреждён о конце договора');

-- ------------------------------------------------------------
-- Очередь доставки
-- ------------------------------------------------------------
set local role authenticated;
select throws_ok($$select * from public.claim_outbox(5)$$, '42501', null, 'Очередь доставки обычному пользователю недоступна');
reset role;
set local role service_role;
create temp table claimed as select * from public.claim_outbox(100);
select ok((select count(*) from claimed) > 0, 'Доставщик забирает готовые задания');
select ok((select bool_and(address is not null) from claimed), 'у каждого есть адрес');
select lives_ok($$select public.finish_outbox((select id from claimed limit 1), 'sent')$$, 'Доставщик отмечает успех');
select lives_ok($$select public.finish_outbox((select id from claimed offset 1 limit 1), 'failed', 'таймаут')$$, 'и ошибку');
reset role;

select * from finish();
rollback;
