-- Шаг 29: вахты.
-- Проверяется: условия вахты и состав, жильё, календарь, суточные и проезд отдельными начислениями, строки акта, затраты на проживание в БДР.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(31);

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('ac000000-0000-0000-0000-0000000000ac', 'acc@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('bb000000-0000-0000-0000-0000000000bb', 'nobody@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 3) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'site_manager' where user_id = '5c000000-0000-0000-0000-0000000000c1';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
delete from public.user_roles where user_id = 'bb000000-0000-0000-0000-0000000000bb';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');
insert into public.clients (id, org_id, name, sales_manager_id, sites_manager_id, status) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active');
insert into public.contracts (id, org_id, client_id, number, signed_on, billing_period, payment_delay_days, status)
  values ('c0170000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Д-1', current_date - 400, 'week', 10, 'active');
insert into public.sites (id, name, client_id, site_manager_id, status, latitude, longitude, checkin_method) values
  ('51e00000-0000-0000-0000-000000000001', 'Вахтовый посёлок', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.7682, 55.097, 'geo');
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 400, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
update public.workers set tax_status = 'ip' where user_id in (select pg_temp.w(i) from generate_series(1, 3) i);
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from generate_series(1, 3) i, public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';

-- Заказ на 3 дня; двое назначены до оформления вахты, третий — после
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select 'a1000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id, current_date + 5, current_date + 7, '08:00', '19:00', 3, 0, 60
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order('a1000000-0000-0000-0000-000000000001');
select public.assign_workers((select array_agg(id) from public.shifts), array[pg_temp.w(1), pg_temp.w(2)]);

select throws_ok($$select public.set_order_rotation('a1000000-0000-0000-0000-000000000001', current_date + 6, current_date + 10, 'Вахтовый городок', 2, 300, true, 200, 700, 300, 1000, 500)$$, '22023', null, 'Заезд позже первой смены не принимается');
select lives_ok($$select public.set_order_rotation('a1000000-0000-0000-0000-000000000001', current_date + 4, current_date + 8, 'Вахтовый городок', 2, 300, true, 200, 700, 300, 1000, 500)$$, 'Вахта оформляется');
select is((select kind from public.orders where id = 'a1000000-0000-0000-0000-000000000001'), 'rotation', 'Заказ получил тип «Вахта»');
select is((select count(*)::int from public.rotation_members), 2, 'Назначенные до оформления вошли в состав вахты');
select public.assign_workers((select array_agg(id) from public.shifts), array[pg_temp.w(3)]);
select is((select count(*)::int from public.rotation_members), 3, 'Назначенный позже добавился сам');
select is((select arrival_date from public.rotation_members where worker_id = pg_temp.w(3)), current_date + 4, 'с датами вахты');

-- Жильё и календарь
select is((select occupied from public.rotation_housing_load(private.default_org_id(), current_date + 5, 1)), 3, 'В жилье в этот день 3 человека');
select is((select free from public.rotation_housing_load(private.default_org_id(), current_date + 5, 1)), -1, 'Мест 2: перебор подсвечивается отрицательным остатком');
select is((select free from public.rotation_housing_load(private.default_org_id(), current_date + 20, 1)), null, 'Вне вахты строк нет');
select is((select count(*)::int from public.rotation_calendar(private.default_org_id(), current_date, 28)), 3, 'Календарь вахт показывает троих');
select is((select count(*)::int from public.rotation_calendar(private.default_org_id(), current_date + 30, 7)), 0, 'За пределами вахты никого');

-- Даты человека
select lives_ok($$select public.set_rotation_member('a1000000-0000-0000-0000-000000000001', pg_temp.w(3), current_date + 5, current_date + 7)$$, 'Даты человека сужаются');
select throws_ok($$select public.set_rotation_member('a1000000-0000-0000-0000-000000000001', pg_temp.w(3), current_date + 3, current_date + 7)$$, '22023', null, 'но не выходят за вахту');
select is((select occupied from public.rotation_housing_load(private.default_org_id(), current_date + 4, 1)), 2, 'Жильё учитывает сокращённые даты');

-- Права
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select public.set_order_rotation('a1000000-0000-0000-0000-000000000001', current_date + 4, current_date + 8, 'x', 1, 1, false, 0, 0, 0, 0, 0)$$, '42501', null, 'Продавец вахту не оформляет');
set local request.jwt.claim.sub = 'bb000000-0000-0000-0000-0000000000bb';
select throws_ok($$select * from public.rotation_calendar(private.default_org_id(), current_date, 7)$$, '42501', null, 'Посторонний календарь не видит');

-- Прошедшая вахта: сутки пребывания в одном месяце
reset role;
update public.order_rotations set arrival_date = date_trunc('month', current_date - interval '1 month')::date + 2, departure_date = date_trunc('month', current_date - interval '1 month')::date + 6;
update public.rotation_members set arrival_date = date_trunc('month', current_date - interval '1 month')::date + 2, departure_date = date_trunc('month', current_date - interval '1 month')::date + 6;

set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is(public.generate_rotation_accruals('a1000000-0000-0000-0000-000000000001'), 6, 'Созданы суточные и проезд на троих: 6 начислений');
select is(public.generate_rotation_accruals('a1000000-0000-0000-0000-000000000001'), 0, 'Повторный запуск ничего не дублирует');
select is((select amount_worker from public.accruals where kind = 'per_diem' and worker_id = pg_temp.w(1)), 3500.00, 'Суточные исполнителю: 5 дней × 700');
select is((select amount_client from public.accruals where kind = 'per_diem' and worker_id = pg_temp.w(1)), 1500.00, 'и заказчику: 5 дней × 300');
select is((select amount_worker from public.accruals where kind = 'travel' and worker_id = pg_temp.w(1)), 1000.00, 'Проезд исполнителю 1 000');
select is((select amount_client from public.accruals where kind = 'travel' and worker_id = pg_temp.w(1)), 500.00, 'и заказчику 500');
select is((select count(*)::int from public.accruals where kind in ('per_diem', 'travel') and status = 'approved'), 6, 'Начисления утверждены и идут в выплаты');

-- Строки акта
create temp table act as select public.generate_client_documents('c1000000-0000-0000-0000-000000000001', date_trunc('month', current_date - interval '1 month')::date, current_date) as id;
grant select on act to authenticated;
select is((select count(*)::int from public.client_document_lines where document_id = (select id from act) and line_kind = 'rotation'), 2, 'В акте две строки вахты: суточные и проезд');
select is((select amount_net from public.client_documents where id = (select id from act)), 6000.00, 'Сумма акта сошлась с начислениями: 3 × (1 500 + 500)');

-- БДР: проживание и питание
select is((select fact from public.bdr_report(array[private.default_org_id()], date_trunc('month', current_date - interval '1 month')::date, (date_trunc('month', current_date - interval '1 month') + interval '1 month - 1 day')::date) where article = 'rotation_costs'), 7500.00, 'Проживание и питание в БДР: 3 человека × 5 дней × (300 + 200)');
select is((select fact from public.bdr_report(array[private.default_org_id()], date_trunc('month', current_date - interval '1 month')::date, (date_trunc('month', current_date - interval '1 month') + interval '1 month - 1 day')::date) where article = 'revenue'), 6000.00, 'Выручка БДР включает суточные и проезд, выставленные заказчику');

-- После начислений правила и состав не меняются
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select throws_ok($$select public.set_order_rotation('a1000000-0000-0000-0000-000000000001', current_date + 4, current_date + 8, 'Вахтовый городок', 2, 300, true, 200, 999, 300, 1000, 500)$$, '22023', null, 'Суточные нельзя поменять после начисления');
select throws_ok($$select public.remove_order_rotation('a1000000-0000-0000-0000-000000000001')$$, '22023', null, 'и снять признак вахты тоже');
select throws_ok($$select public.remove_rotation_member('a1000000-0000-0000-0000-000000000001', pg_temp.w(1))$$, '22023', null, 'и убрать человека');
reset role;
select is(private.generate_due_rotation_accruals(), 0, 'Ночная задача не дублирует начисления');

select * from finish();
rollback;
