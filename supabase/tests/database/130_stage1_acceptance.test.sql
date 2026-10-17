-- Приёмка этапа 1 (ТЗ, раздел 20): заказ → смены → назначения → отметки → табель, подтверждённый заказчиком →
-- начисления с маржой; расчёты сходятся до копейки; чужая организация не видна.
-- Сценарий проходит только через публичные функции под ролями участников; под суперпользователем
-- делается лишь сдвиг времени смен «в сегодня» (в тесте нельзя ждать суток).
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(30);

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

-- Организация 2: руководитель, заказчик и объект. Ничего из этого не должно быть видно организации 1 и наоборот.
insert into public.organizations (id, name) values ('b2000000-0000-0000-0000-000000000002', 'Вторая организация');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('d2000000-0000-0000-0000-0000000000d2', 'd2@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'cu@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 3) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'director', org_id = 'b2000000-0000-0000-0000-000000000002' where user_id = 'd2000000-0000-0000-0000-0000000000d2';
update public.user_roles set role = 'site_manager' where user_id = '5c000000-0000-0000-0000-0000000000c1';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
update public.user_roles set role = 'client_admin' where user_id = 'c0000000-0000-0000-0000-00000000000c';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('d2000000-0000-0000-0000-0000000000d2', 'Директор 2', 'management'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');

insert into public.clients (id, org_id, name, sales_manager_id, sites_manager_id) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1'),
  ('c2000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000002', 'Чужой заказчик', NULL, NULL);
insert into public.client_contacts (org_id, client_id, full_name, user_id, cabinet_role)
  values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Кабинет 1', 'c0000000-0000-0000-0000-00000000000c', 'client_admin');
insert into public.sites (id, org_id, name, client_id, site_manager_id, status, latitude, longitude, checkin_method, checkin_radius_m) values
  ('51e00000-0000-0000-0000-000000000001', private.default_org_id(), 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.7682, 55.097, 'geo', 200),
  ('52e00000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000002', 'Чужой склад', 'c2000000-0000-0000-0000-000000000002', NULL, 'active', 51.0, 55.0, 'geo', 200);
-- Тариф 450/300 без коэффициентов: ночные и праздничные доли здесь не проверяются, чтобы сценарий не зависел от времени суток
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 30, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
update public.workers set tax_status = case user_id when pg_temp.w(1) then 'ip' when pg_temp.w(2) then 'self_employed' else 'gph' end
  where user_id in (select pg_temp.w(i) from generate_series(1, 3) i);
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from generate_series(1, 3) i, public.positions p
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';

-- 1. Заказчик оформляет заказ из кабинета: два дня, трое, с 08:00 до 19:00, перерыв час
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select lives_ok($$insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes, source)
  select 'a1000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
         current_date + 2, current_date + 3, '08:00', '19:00', 3, 0, 60, 'cabinet'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик'$$, 'Заказчик оформляет заказ в кабинете');

-- 2. Менеджер принимает заказ → две смены
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select is(public.accept_order('a1000000-0000-0000-0000-000000000001'), 2, 'Принятый заказ дал две смены');
select is((select count(*)::int from public.shift_staffing), 2, 'Обе смены в сетке планирования');

-- 3. Назначение троих на обе смены
select is((select count(*)::int from public.assign_workers((select array_agg(id) from public.shifts), array[pg_temp.w(1), pg_temp.w(2), pg_temp.w(3)]) where result = 'assigned'), 6,
          'Шесть назначений: трое на две смены');
select is((select min(assigned_count) from public.shift_staffing), 3, 'Смены укомплектованы');

-- 4. Исполнители подтверждают выход
set local request.jwt.claim.sub = '77000001-0000-0000-0000-000000000000';
select lives_ok($$select public.confirm_assignment(id) from public.assignments where worker_id = pg_temp.w(1)$$, 'Исполнитель подтверждает выход');
set local request.jwt.claim.sub = '77000002-0000-0000-0000-000000000000';
select public.confirm_assignment(id) from public.assignments where worker_id = pg_temp.w(2);
set local request.jwt.claim.sub = '77000003-0000-0000-0000-000000000000';
select public.confirm_assignment(id) from public.assignments where worker_id = pg_temp.w(3);

-- Сдвиг времени: первая смена идёт сейчас (началась 10 минут назад), вторая прошла двое суток назад
reset role;
create temp table sh as select id, shift_date, row_number() over (order by shift_date) as n from public.shifts;
grant select on sh to authenticated;
update public.shifts set shift_date = current_date, start_at = now() - interval '10 minutes', end_at = now() + interval '590 minutes'
 where id = (select id from sh where n = 1);
update public.shifts set shift_date = current_date - 2, start_at = now() - interval '35 hours', end_at = now() - interval '25 hours'
 where id = (select id from sh where n = 2);
update public.assignments a set shift_start = s.start_at, shift_end = s.end_at from public.shifts s where s.id = a.shift_id;

-- 5. Отметки. Первая смена: исполнители сами по геолокации. Вторая: менеджер вручную с причиной.
set local role authenticated;
set local request.jwt.claim.sub = '77000001-0000-0000-0000-000000000000';
select throws_ok($$select public.check_in(a.id, 51.7710, 55.097) from public.assignments a join sh on sh.id = a.shift_id where a.worker_id = pg_temp.w(1) and sh.n = 1$$,
                 '22023', null, 'Исполнитель в 300 м от объекта не может отметиться');
select lives_ok($$select public.check_in(a.id, 51.7683, 55.0971, 8) from public.assignments a join sh on sh.id = a.shift_id where a.worker_id = pg_temp.w(1) and sh.n = 1$$, 'W1 отметился на месте');
set local request.jwt.claim.sub = '77000002-0000-0000-0000-000000000000';
select public.check_in(a.id, 51.7683, 55.0971, 8) from public.assignments a join sh on sh.id = a.shift_id where a.worker_id = pg_temp.w(2) and sh.n = 1;
set local request.jwt.claim.sub = '77000003-0000-0000-0000-000000000000';
select public.check_in(a.id, 51.7683, 55.0971, 8) from public.assignments a join sh on sh.id = a.shift_id where a.worker_id = pg_temp.w(3) and sh.n = 1;

-- Заказчик видит отметки прихода сразу
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select is((select on_site_count from public.client_shifts(current_date, current_date) limit 1), 3, 'Заказчик видит трёх на месте без перезагрузки');

-- Уход первой смены
set local request.jwt.claim.sub = '77000001-0000-0000-0000-000000000000';
select public.check_out(a.id, 51.7683, 55.0971, 8) from public.assignments a join sh on sh.id = a.shift_id where a.worker_id = pg_temp.w(1) and sh.n = 1;
set local request.jwt.claim.sub = '77000002-0000-0000-0000-000000000000';
select public.check_out(a.id, 51.7683, 55.0971, 8) from public.assignments a join sh on sh.id = a.shift_id where a.worker_id = pg_temp.w(2) and sh.n = 1;
set local request.jwt.claim.sub = '77000003-0000-0000-0000-000000000000';
select public.check_out(a.id, 51.7683, 55.0971, 8) from public.assignments a join sh on sh.id = a.shift_id where a.worker_id = pg_temp.w(3) and sh.n = 1;

-- Вторая смена: ручные отметки менеджера
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select lives_ok($$select public.manual_check(a.id, 'in', now() - interval '35 hours', 'Телефоны остались в раздевалке'),
                         public.manual_check(a.id, 'out', now() - interval '25 hours', 'Телефоны остались в раздевалке')
                  from public.assignments a join sh on sh.id = a.shift_id where sh.n = 2$$, 'Менеджер вручную отмечает вторую смену');
select is((select count(*)::int from public.assignments where status = 'worked'), 6, 'Все шесть смен отработаны');
select is((select approved_hours from public.assignments a join sh on sh.id = a.shift_id where a.worker_id = pg_temp.w(1) and sh.n = 1), 9.00, 'Часы за смену: десять часов минус перерыв — девять');

-- 6. Табель собирается, отправляется и подтверждается заказчиком
create temp table ts as select public.build_timesheet('51e00000-0000-0000-0000-000000000001', current_date - 3, current_date + 1) as id;
grant select on ts to authenticated;
select is((select count(*)::int from public.assignments where timesheet_id = (select id from ts)), 6, 'В табеле шесть строк');
select lives_ok($$select public.send_timesheet((select id from ts))$$, 'Менеджер отправляет табель заказчику');

set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select lives_ok($$select public.confirm_timesheet((select id from ts))$$, 'Заказчик подтверждает табель');
select is((select status from public.timesheets where id = (select id from ts)), 'confirmed', 'Табель подтверждён');

-- 7. Начисления и маржа: суммы сходятся до копейки
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select is((select count(*)::int from public.accruals where kind = 'main'), 6, 'Шесть основных начислений');
select is((select to_invoice from public.client_statement(current_date - 3, current_date + 1)), 24300.00, 'К выставлению: 18 ч × 3 × 450 = 24 300');
select is((select payout from public.client_statement(current_date - 3, current_date + 1)), 16200.00, 'К выплате исполнителям: 18 ч × 3 × 300 = 16 200');
select is((select taxes_and_fees from public.client_statement(current_date - 3, current_date + 1)), 2776.96, 'Налоги, взносы и комиссия: (54,00 + 1 334,48) за смену × 2');
select is((select margin from public.client_statement(current_date - 3, current_date + 1)), 5323.04, 'Маржа: 24 300 − 16 200 − 2 776,96 = 5 323,04');
select is((select string_agg(to_pay::text, ',' order by worker_name) from public.worker_statement(current_date - 3, current_date + 1) where tax_status = 'ip'), '5400.00', 'У ИП к выплате 5 400 за две смены');

-- 8. Заказчик видит свою сумму и не видит чужого
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select is((select sum(amount_client) from public.client_accruals(current_date - 3, current_date + 1)), 24300.00, 'Заказчик видит те же 24 300');
select is((select count(*)::int from public.accruals), 0, 'но не саму таблицу начислений со ставками исполнителей');

-- 9. Чужая организация не видна
set local request.jwt.claim.sub = 'd2000000-0000-0000-0000-0000000000d2';
select is((select count(*)::int from public.orders) + (select count(*)::int from public.shifts) + (select count(*)::int from public.assignments)
          + (select count(*)::int from public.timesheets) + (select count(*)::int from public.accruals) + (select count(*)::int from public.notifications), 0,
          'Руководитель организации 2 не видит ни заказов, ни смен, ни табелей, ни начислений организации 1');
select is((select count(*)::int from public.client_statement(current_date - 30, current_date + 30)) + (select count(*)::int from public.worker_statement(current_date - 30, current_date + 30)), 0,
          'и ведомости пусты');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select is((select count(*)::int from public.clients where id = 'c2000000-0000-0000-0000-000000000002'), 0, 'Руководитель организации 1 не видит заказчика организации 2');
select is((select count(*)::int from public.sites where id = '52e00000-0000-0000-0000-000000000002'), 0, 'и её объект');

-- 10. Журнал и уведомления
select ok((select count(*) from public.audit_log where table_name = 'accruals') >= 6, 'Начисления записаны в журнал');
reset role;
select ok(exists (select 1 from public.notifications where user_id = 'c0000000-0000-0000-0000-00000000000c' and event = 'timesheet_sent'), 'Заказчик получил уведомление о табеле');

select * from finish();
rollback;
