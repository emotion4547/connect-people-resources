-- Шаг 9: отметки, часы, табель, споры, оценки.
-- Приёмка из ТЗ (раздел 9): исполнитель в 300 м от объекта отметиться не может; табель, в котором заказчик
-- оспорил одну строку, подтверждается остальными; без ответа в срок табель подтверждается сам.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(55);

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('5d000000-0000-0000-0000-0000000000d2', 'sm2@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'cu@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 6) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'site_manager' where user_id in ('5c000000-0000-0000-0000-0000000000c1', '5d000000-0000-0000-0000-0000000000d2');
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
update public.user_roles set role = 'client_admin' where user_id = 'c0000000-0000-0000-0000-00000000000c';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта 1', 'sites'),
  ('5d000000-0000-0000-0000-0000000000d2', 'Менеджер объекта 2', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');

insert into public.clients (id, org_id, name, sales_manager_id, sites_manager_id) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1');
insert into public.client_contacts (org_id, client_id, full_name, user_id, cabinet_role)
  values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Кабинет 1', 'c0000000-0000-0000-0000-00000000000c', 'client_admin');
insert into public.sites (id, name, client_id, site_manager_id, status, latitude, longitude, checkin_method, checkin_radius_m) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1',
   'active', 51.768200, 55.097000, 'geo', 200);
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 30, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
update public.workers set tax_status = 'self_employed' where user_id in (select pg_temp.w(i) from generate_series(1, 6) i);
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from generate_series(1, 6) i, public.positions p
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';

-- Заказ 1 (смена идёт сейчас): W1, W6. Заказ 2 (смена закончилась): W2, W3, W4, W5.
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select o.id, private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
         current_date + o.d, current_date + o.d, '08:00', '17:00', o.n, 0, 60
  from public.positions p, (values ('a1000000-0000-0000-0000-000000000001'::uuid, 2, 2), ('a2000000-0000-0000-0000-000000000002'::uuid, 3, 4)) o(id, d, n)
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order('a1000000-0000-0000-0000-000000000001');
select public.accept_order('a2000000-0000-0000-0000-000000000002');
select public.assign_workers((select array_agg(id) from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001'),
                             array[pg_temp.w(1), pg_temp.w(6)]);
select public.assign_workers((select array_agg(id) from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'),
                             array[pg_temp.w(2), pg_temp.w(3), pg_temp.w(4), pg_temp.w(5)]);

-- Переносим смены в «сейчас»: заказ 1 начался 20 минут назад (8 часов), заказ 2 шёл с -11 до -3 часов.
reset role;
update public.shifts set shift_date = current_date, start_at = now() - interval '20 minutes', end_at = now() + interval '460 minutes'
  where order_id = 'a1000000-0000-0000-0000-000000000001';
update public.shifts set shift_date = current_date, start_at = now() - interval '11 hours', end_at = now() - interval '3 hours'
  where order_id = 'a2000000-0000-0000-0000-000000000002';
update public.assignments a set shift_start = s.start_at, shift_end = s.end_at, status = 'confirmed' from public.shifts s where s.id = a.shift_id;
create temp table aid as select (right(worker_id::text, 24) is not null) as ok, regexp_replace(left(worker_id::text, 8), '^770000', '')::int as w, id from public.assignments;
grant select on aid to authenticated;
select is((select count(*)::int from public.assignments where status = 'confirmed'), 6, 'Подготовка: шесть назначений подтверждены');

-- ------------------------------------------------------------
-- Отметка прихода: геолокация
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '77000001-0000-0000-0000-000000000000';
select throws_ok(
  $$select public.check_in((select a.id from public.assignments a where a.worker_id = pg_temp.w(1)), 51.770900, 55.097000)$$,
  '22023', null, 'Исполнитель в 300 м от объекта отметиться не может');
select throws_ok(
  $$select public.check_in((select a.id from public.assignments a where a.worker_id = pg_temp.w(1)))$$,
  '22023', null, 'Без координат отметка не принимается');
set local request.jwt.claim.sub = '77000002-0000-0000-0000-000000000000';
select throws_ok(
  $$select public.check_in((select a.id from public.assignments a where a.worker_id = pg_temp.w(1)), 51.768200, 55.097000)$$,
  '42501', null, 'Чужое назначение отметить нельзя');
set local request.jwt.claim.sub = '77000001-0000-0000-0000-000000000000';
select lives_ok(
  $$select public.check_in((select a.id from public.assignments a where a.worker_id = pg_temp.w(1)), 51.768300, 55.097100, 12)$$,
  'В радиусе объекта отметка принимается');
select is((select status || '/' || check_in_method || '/' || late_minutes from public.assignments where worker_id = pg_temp.w(1)),
          'on_site/geo/20', 'Приход записан: способ geo, опоздание 20 минут');
select throws_ok(
  $$select public.check_in((select a.id from public.assignments a where a.worker_id = pg_temp.w(1)), 51.768200, 55.097000)$$,
  '22023', null, 'Повторно прийти нельзя');
select throws_ok(
  $$select public.check_out((select a.id from public.assignments a where a.worker_id = pg_temp.w(1)), 51.770900, 55.097000)$$,
  '22023', null, 'Уйти издалека тоже нельзя');
select lives_ok(
  $$select public.check_out((select a.id from public.assignments a where a.worker_id = pg_temp.w(1)), 51.768200, 55.097000)$$,
  'Уход в радиусе принимается');
-- Режим «по графику»: плановое время 7 ч, опоздание 20 мин сверх допуска вычитается.
select is((select status || '/' || planned_hours || '/' || approved_hours from public.assignments where worker_id = pg_temp.w(1)),
          'worked/7.00/6.67', 'По графику: 7 ч минус 20 минут опоздания');

-- Способ «QR + геолокация»: код обязателен, устаревший код не проходит
reset role;
update public.sites set checkin_method = 'both' where id = '51e00000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
create temp table qr as select public.site_qr_payload('51e00000-0000-0000-0000-000000000001') as p;
grant select on qr to authenticated;
set local request.jwt.claim.sub = '77000006-0000-0000-0000-000000000000';
select throws_ok(
  $$select public.check_in((select a.id from public.assignments a where a.worker_id = pg_temp.w(6)), 51.768200, 55.097000)$$,
  '22023', null, 'Способ «QR + геолокация»: без кода отметка не принимается');
select throws_ok(
  $$select public.check_in((select a.id from public.assignments a where a.worker_id = pg_temp.w(6)), 51.768200, 55.097000, 10, 'RV1.51e00000-0000-0000-0000-000000000001.0000000000000000')$$,
  '22023', null, 'Неверный код не принимается');
select lives_ok(
  $$select public.check_in((select a.id from public.assignments a where a.worker_id = pg_temp.w(6)), 51.768200, 55.097000, 10, (select p from qr))$$,
  'Верный код и координаты принимаются');

-- ------------------------------------------------------------
-- Ручные отметки, часы по факту, переработка
-- ------------------------------------------------------------
reset role;
update public.sites set hours_mode = 'actual', checkin_method = 'geo' where id = '51e00000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub = '5d000000-0000-0000-0000-0000000000d2';
select throws_ok(
  $$select public.manual_check((select a.id from public.assignments a where a.worker_id = pg_temp.w(2)), 'in', now() - interval '11 hours', 'Телефон сел')$$,
  '42501', null, 'Чужой менеджер ручную отметку ставить не может');
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select throws_ok(
  $$select public.manual_check((select a.id from public.assignments a where a.worker_id = pg_temp.w(2)), 'in', now() - interval '11 hours', '')$$,
  '22023', null, 'Ручная отметка без причины не принимается');
select throws_ok(
  $$select public.manual_check((select a.id from public.assignments a where a.worker_id = pg_temp.w(2)), 'in', now() + interval '1 hour', 'Телефон сел')$$,
  '22023', null, 'Отметка в будущем не принимается');
select lives_ok(
  $$select public.manual_check((select a.id from public.assignments a where a.worker_id = pg_temp.w(2)), 'in', now() - interval '11 hours', 'Телефон сел'),
           public.manual_check((select a.id from public.assignments a where a.worker_id = pg_temp.w(2)), 'out', now() - interval '3 hours', 'Телефон сел'),
           public.manual_check((select a.id from public.assignments a where a.worker_id = pg_temp.w(3)), 'in', now() - interval '11 hours', 'Нет связи'),
           public.manual_check((select a.id from public.assignments a where a.worker_id = pg_temp.w(3)), 'out', now() - interval '2 hours', 'Нет связи'),
           public.manual_check((select a.id from public.assignments a where a.worker_id = pg_temp.w(5)), 'in', now() - interval '11 hours', 'Нет связи')$$,
  'Менеджер отмечает приход и уход вручную');
select is((select check_in_method || '/' || check_in_manual_reason from public.assignments where worker_id = pg_temp.w(2)),
          'manual/Телефон сел', 'Ручная отметка хранит причину');
reset role;
select ok(exists (select 1 from public.audit_log where note like 'ручная отметка:%' and record_id = (select id::text from public.assignments where worker_id = pg_temp.w(2))),
          'Ручная отметка попала в журнал');
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
-- 8 часов от прихода до ухода, перерыв час: 7 ч — ровно по плану
select is((select approved_hours || '/' || overtime_hours from public.assignments where worker_id = pg_temp.w(2)), '7.00/0.00', 'По факту: 8 ч минус перерыв = 7 ч');
-- W3 ушёл на час позже конца: час переработки не оплачивается, пока менеджер не утвердил
select is((select approved_hours || '/' || overtime_hours || '/' || overtime_approved_hours from public.assignments where worker_id = pg_temp.w(3)),
          '7.00/1.00/0.00', 'Переработка час: в часы пока не входит');
select lives_ok($$select public.approve_overtime((select id from public.assignments where worker_id = pg_temp.w(3)), 0.5)$$, 'Менеджер утверждает полчаса переработки');
select is((select approved_hours from public.assignments where worker_id = pg_temp.w(3)), 7.50, 'Утверждённые полчаса вошли в часы');
select throws_ok($$select public.approve_overtime((select id from public.assignments where worker_id = pg_temp.w(3)), 3)$$,
                 '22023', null, 'Утвердить больше фактической переработки нельзя');
reset role;
select is((select night from private.split_minutes(timestamptz '2026-03-02 18:00+00', timestamptz '2026-03-03 02:00+00', 'UTC', private.default_org_id())), 240, 'Ночные часы (22:00–06:00) выделены из смены');
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';

-- ------------------------------------------------------------
-- Сигналы и расписание
-- ------------------------------------------------------------
select is((select count(*)::int from public.attendance_alerts where worker_id = pg_temp.w(6)), 0, 'Пришедший не попадает в сигналы о неявке');
reset role;
-- W6 уже отметился; для проверки сигнала откатываем его в «подтверждён»
update public.assignments set status = 'confirmed', check_in_at = null, check_in_method = null where worker_id = pg_temp.w(6);
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select is((select count(*)::int from public.attendance_alerts where worker_id = pg_temp.w(6)), 1, 'Через 15 минут без отметки появляется сигнал менеджеру');
reset role;
select is(private.process_attendance(), 2, 'Расписание: один уход закрыт автоматически и один «не вышел»');
select is((select status || '/' || check_out_auto from public.assignments where worker_id = pg_temp.w(5)), 'worked/true', 'Забытый уход проставлен по графику с пометкой «авто»');
select is((select approved_hours from public.assignments where worker_id = pg_temp.w(5)), 7.00, 'Часы авто-ухода — по плану');
select is((select status from public.assignments where worker_id = pg_temp.w(4)), 'no_show', 'Не пришёл за два часа — «не вышел»');

-- ------------------------------------------------------------
-- Табель
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
create temp table ts as select public.build_timesheet('51e00000-0000-0000-0000-000000000001', current_date - 1, current_date + 1) as id;
grant select on ts to authenticated;
select is((select count(*)::int from public.assignments where timesheet_id = (select id from ts)), 4, 'В табель вошли четыре отработанные смены');
select throws_ok($$select public.confirm_timesheet((select id from ts))$$, '42501', null, 'Менеджер за заказчика табель не подтверждает');
set local request.jwt.claim.sub = '5d000000-0000-0000-0000-0000000000d2';
select throws_ok($$select public.send_timesheet((select id from ts))$$, '42501', null, 'Чужой менеджер табель не отправляет');
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select lives_ok($$select public.send_timesheet((select id from ts))$$, 'Менеджер отправляет табель заказчику');
select is((select confirm_deadline from public.timesheets where id = (select id from ts)), now() + interval '48 hours', 'Срок подтверждения — 48 часов');

set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select is((select count(*)::int from public.timesheet_lines((select id from ts))), 4, 'Заказчик видит строки табеля');
select throws_ok($$select public.dispute_line((select id from ts), (select id from aid where w = 3), 7, '')$$,
                 '22023', null, 'Спор без причины не принимается');
select lives_ok($$select public.dispute_line((select id from ts), (select id from aid where w = 3), 7, 'Ушёл в 15:00')$$,
                'Заказчик оспаривает одну строку');
select lives_ok($$select public.confirm_timesheet((select id from ts))$$, 'Заказчик подтверждает остальные');
reset role;
select is((select string_agg(distinct line_status, ',' order by line_status) from public.assignments where timesheet_id = (select id from ts)),
          'confirmed,disputed', 'Три строки подтверждены, одна спорная');
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select is((select status from public.timesheets where id = (select id from ts)), 'disputed', 'Табель остаётся «Есть споры»');

reset role;
select throws_ok($$update public.assignments set approved_hours = 1 where worker_id = pg_temp.w(2)$$, '22023', null, 'Подтверждённая строка не правится');

set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select throws_ok($$select public.resolve_dispute((select id from public.timesheet_disputes limit 1), false, '')$$, '22023', null, 'Отклонить спор без объяснения нельзя');
select lives_ok($$select public.resolve_dispute((select id from public.timesheet_disputes limit 1), true, 'Согласны, ушёл рано')$$, 'Менеджер принимает правку заказчика');
select is((select approved_hours from public.assignments where worker_id = pg_temp.w(3)), 7.00, 'Часы строки заменены предложенными');
select is((select status || '/' || confirmed_auto from public.timesheets where id = (select id from ts)), 'confirmed/false', 'Табель подтверждён вручную');

-- Автоподтверждение: второй табель без ответа заказчика
reset role;
update public.assignments set status = 'worked', timesheet_id = null, line_status = null where worker_id = pg_temp.w(4);
update public.assignments set check_in_at = now() - interval '11 hours', check_out_at = now() - interval '3 hours', approved_hours = 7 where worker_id = pg_temp.w(4);
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
create temp table ts2 as select public.build_timesheet('51e00000-0000-0000-0000-000000000001', current_date, current_date) as id;
select public.send_timesheet((select id from ts2));
reset role;
update public.timesheets set confirm_deadline = now() - interval '1 minute' where id = (select id from ts2);
select is(private.autoconfirm_timesheets(), 1, 'Расписание подтверждает табель без ответа в срок');
select is((select status || '/' || confirmed_auto from public.timesheets where id = (select id from ts2)), 'confirmed/true', 'Автоподтверждение помечено');

-- ------------------------------------------------------------
-- Оценки и рейтинг
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select lives_ok($$select public.rate_assignment((select id from aid where w = 2), 4, 'Хорошо')$$, 'Менеджер ставит оценку');
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select lives_ok($$select public.rate_assignment((select id from aid where w = 2), 5, 'Отлично')$$, 'Заказчик ставит оценку');
reset role;
select is((select rating from public.workers where user_id = pg_temp.w(2)), 4.50, 'Рейтинг — среднее оценок менеджера и заказчика');
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select lives_ok($$select public.rate_assignment((select id from aid where w = 3), 1, 'Грубил', true)$$, 'Оценка 1 вносит в стоп-лист объекта');
reset role;
select is((select count(*)::int from public.worker_blocks where worker_id = pg_temp.w(3) and site_id = '51e00000-0000-0000-0000-000000000001'), 1, 'Исполнитель в стоп-листе объекта');
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select throws_ok($$select public.rate_assignment((select id from aid where w = 2), 6)$$, '22023', null, 'Оценка вне 1–5 не принимается');

select * from finish();
rollback;
