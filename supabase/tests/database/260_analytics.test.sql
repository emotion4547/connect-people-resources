-- Шаг 25: метрики и агрегаты аналитики.
-- Приёмка из ТЗ (раздел 17): укомплектованность и маржа совпадают с ручным пересчётом по списку записей.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(34);

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('ac000000-0000-0000-0000-0000000000ac', 'acc@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('51000000-0000-0000-0000-000000000002', 's2@test.local'),
  ('4e000000-0000-0000-0000-0000000000e1', 'rec@test.local'),
  ('ad000000-0000-0000-0000-0000000000ad', 'adm@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 5) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'site_manager' where user_id = '5c000000-0000-0000-0000-0000000000c1';
update public.user_roles set role = 'sales' where user_id in ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000002');
update public.user_roles set role = 'recruiter' where user_id = '4e000000-0000-0000-0000-0000000000e1';
update public.user_roles set role = 'admin' where user_id = 'ad000000-0000-0000-0000-0000000000ad';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец 1', 'sales'),
  ('51000000-0000-0000-0000-000000000002', 'Продавец 2', 'sales'),
  ('4e000000-0000-0000-0000-0000000000e1', 'Рекрутер', 'hiring'),
  ('ad000000-0000-0000-0000-0000000000ad', 'Админ', 'admin');
insert into public.clients (id, org_id, name, sales_manager_id, sites_manager_id, status) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active');
insert into public.contracts (id, org_id, client_id, number, signed_on, billing_period, payment_delay_days, status)
  values ('c0170000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Д-1', current_date - 400, 'week', 10, 'active');
insert into public.sites (id, name, client_id, site_manager_id, status, latitude, longitude, checkin_method) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.7682, 55.097, 'geo');
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 400, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
update public.workers set tax_status = 'ip' where user_id in (select pg_temp.w(i) from generate_series(1, 5) i);
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from generate_series(1, 5) i, public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';

-- Прошедшая смена: нужно 4 человека; будущая смена: нужно 2
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select o.id, private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id, current_date + o.d, current_date + o.d, '08:00', '19:00', o.n, 0, 60
  from public.positions p join (values ('a1000000-0000-0000-0000-000000000001'::uuid, 2, 4), ('a2000000-0000-0000-0000-000000000002'::uuid, 5, 2)) o(id, d, n) on true
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order(id) from public.orders;
select public.assign_workers((select array_agg(s.id) from public.shifts s where s.order_id = 'a1000000-0000-0000-0000-000000000001'), array[pg_temp.w(1), pg_temp.w(2), pg_temp.w(3), pg_temp.w(4)]);
select public.assign_workers((select array_agg(s.id) from public.shifts s where s.order_id = 'a2000000-0000-0000-0000-000000000002'), array[pg_temp.w(1)]);
reset role;

-- Первая смена прошла 10 дней назад: двое отработали, один не вышел, один подтвердил, но не отметился
update public.shifts set shift_date = current_date - 10, start_at = (current_date - 10 + time '08:00')::timestamptz, end_at = (current_date - 10 + time '19:00')::timestamptz
  where order_id = 'a1000000-0000-0000-0000-000000000001';
update public.assignments a set shift_start = s.start_at, shift_end = s.end_at from public.shifts s where s.id = a.shift_id and s.order_id = 'a1000000-0000-0000-0000-000000000001';
update public.assignments set status = 'worked', planned_hours = 10, approved_hours = 10 where worker_id in (pg_temp.w(1), pg_temp.w(2)) and shift_start::date = current_date - 10;
update public.assignments set status = 'no_show' where worker_id = pg_temp.w(3) and shift_start::date = current_date - 10;
update public.assignments set status = 'confirmed' where worker_id = pg_temp.w(4) and shift_start::date = current_date - 10;
update public.assignments set status = 'confirmed' where shift_start::date > current_date;
select private.create_accrual_for_assignment(a.id) from public.assignments a where a.status = 'worked';
update public.accruals set shift_date = current_date - 10, period_month = date_trunc('month', current_date - 10)::date;

-- Найм: допущенный 110 дней назад, который работал, и ещё два кандидата
update public.workers set admitted_at = now() - interval '110 days' where user_id = pg_temp.w(1);
insert into public.candidates (id, org_id, full_name, stage, admitted_worker_id, created_at) values
  ('ca000000-0000-0000-0000-000000000001', private.default_org_id(), 'Принятый', 'admitted', pg_temp.w(1), now() - interval '115 days'),
  ('ca000000-0000-0000-0000-000000000002', private.default_org_id(), 'Другой', 'interview', null, now() - interval '20 days'),
  ('ca000000-0000-0000-0000-000000000003', private.default_org_id(), 'Третий', 'interview', null, now() - interval '5 days');

create temp table per as select current_date - 120 as d_from, current_date + 10 as d_to;
grant select on per to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
create temp table mt as select m.* from per, public.analytics_metrics(array[private.default_org_id()], per.d_from, per.d_to) m;
grant select on mt to authenticated;

-- Операционные показатели
select is((select num from mt where metric = 'staffing'), 4::numeric, 'Подтвердили 4: двое отработали, один подтвердил, один подтвердил на будущую смену');
select is((select den from mt where metric = 'staffing'), 6::numeric, 'Нужно 6: 4 на прошедшую и 2 на будущую смену');
select is((select value from mt where metric = 'staffing'), 66.7, 'Укомплектованность 66,7%');
select is((select value from mt where metric = 'attendance'), 50.0, 'Выход: на месте 2 из 4 нужных на начавшуюся смену');
select is((select value from mt where metric = 'no_show'), 25.0, 'Неявки: 1 из 4 назначенных на начавшуюся смену');
select is((select value from mt where metric = 'hours'), 20.00, 'Отработано 20 часов');

-- Финансы: сверка с начислениями
select is((select value from mt where metric = 'revenue'), (select sum(amount_client) from public.accruals), 'Выручка равна сумме начислений');
select is((select value from mt where metric = 'margin_amount'), (select sum(margin) from public.accruals), 'Маржа равна сумме маржи начислений');
select is((select value from mt where metric = 'margin_pct'), round((select sum(margin) / sum(amount_client) * 100 from public.accruals), 1), 'Маржинальность — маржа к выручке');

-- Приёмка: число складывается из записей списка
select is((select sum(amount) from public.analytics_records(array[private.default_org_id()], 'staffing', (select d_from from per), (select d_to from per))), (select num from mt where metric = 'staffing'), 'Записи укомплектованности дают то же число, что метрика');
select is((select sum(amount) from public.analytics_records(array[private.default_org_id()], 'attendance', (select d_from from per), (select d_to from per))), (select num from mt where metric = 'attendance'), 'и по выходу');
select is((select sum(amount) from public.analytics_records(array[private.default_org_id()], 'no_show', (select d_from from per), (select d_to from per))), (select num from mt where metric = 'no_show'), 'и по неявкам');
select is((select sum(amount) from public.analytics_records(array[private.default_org_id()], 'margin_amount', (select d_from from per), (select d_to from per))), (select value from mt where metric = 'margin_amount'), 'и по марже — по списку начислений');
select is((select count(*)::int from public.analytics_records(array[private.default_org_id()], 'revenue', (select d_from from per), (select d_to from per))), 2, 'Выручка складывается из двух начислений');

-- Активная база и время закрытия
select is((select value from public.analytics_metrics(array[private.default_org_id()], current_date - 40, current_date + 25) where metric = 'active_base'), 0::numeric, 'Активная база — окно 30 дней до конца периода: смена 10 дней назад в него не попадает');
select is((select value from public.analytics_metrics(array[private.default_org_id()], current_date - 40, current_date - 5) where metric = 'active_base'), 2::numeric, 'а для периода, заканчивающегося вскоре после смены, активных двое');
select ok((select value from mt where metric = 'order_close_hours') >= 0, 'Время закрытия заказа считается');

-- Найм
select is((select value from mt where metric = 'hire_conversion'), 33.3, 'Конверсия найма: 1 из 3 кандидатов периода');
select is((select value from mt where metric = 'time_to_admit_days'), 5.0, 'Время до допуска 5 дней');
select is((select value from mt where metric = 'retention_30'), 100.0, 'Удержание 30: допущенный работал позже чем через 30 дней');
select is((select value from mt where metric = 'retention_90'), 100.0, 'и позже чем через 90 дней (смена 10 дней назад при допуске 110 дней назад)');

-- Дебиторка
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
create temp table act as select public.generate_client_documents('c1000000-0000-0000-0000-000000000001', current_date - 30, current_date - 5) as id;
grant select on act to authenticated;
select public.issue_client_documents((select id from act));
reset role;
update public.client_documents set due_date = current_date - 3 where kind = 'invoice';
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select is((select value from public.analytics_metrics(array[private.default_org_id()], current_date - 30, current_date) where metric = 'overdue_receivables'), (select sum(amount_client) from public.accruals), 'Просроченная дебиторка равна сумме неоплаченного счёта');
select is((select count(*)::int from public.analytics_records(array[private.default_org_id()], 'overdue_receivables', current_date - 30, current_date)), 1, 'и в списке один счёт');

-- Агрегаты свежие: изменение данных сразу меняет метрику без ручного пересчёта
reset role;
update public.assignments set status = 'on_site' where worker_id = pg_temp.w(4) and shift_start::date = current_date - 10;
select is((select count(*)::int from public.analytics_dirty), 1, 'Изменение назначения пометило день на пересчёт');
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select is((select value from public.analytics_metrics(array[private.default_org_id()], current_date - 120, current_date + 10) where metric = 'attendance'), 75.0, 'Выход вырос до 75%: метрика пересчитана при чтении');
reset role;
select is((select count(*)::int from public.analytics_dirty), 0, 'и пометки сняты');
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';

-- Сравнение и динамика
select is((select prev_value from public.analytics_compare(array[private.default_org_id()], current_date - 5, current_date, null) where metric = 'revenue'), (select sum(amount_client) from public.accruals), 'Сравнение берёт прошлый период той же длины: выручка прошлых 6 дней');
select is((select sum(revenue) from public.analytics_series(array[private.default_org_id()], current_date - 120, current_date + 10, 'month')), (select sum(amount_client) from public.accruals), 'Динамика по месяцам даёт ту же выручку');

-- Права
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000002';
select is((select value from public.analytics_metrics(array[private.default_org_id()], current_date - 120, current_date + 10) where metric = 'revenue'), 0::numeric, 'Менеджер продаж без заказчиков видит нули, а не чужие цифры');
select is((select count(*)::int from public.analytics_metrics(array[private.default_org_id()], current_date - 120, current_date + 10) where metric like 'retention%'), 0, 'и показателей найма не видит');
set local request.jwt.claim.sub = '4e000000-0000-0000-0000-0000000000e1';
select is((select count(*)::int from public.analytics_metrics(array[private.default_org_id()], current_date - 120, current_date + 10) where metric = 'revenue'), 0, 'Рекрутёру финансовые показатели недоступны');
select ok((select count(*) from public.analytics_metrics(array[private.default_org_id()], current_date - 120, current_date + 10) where metric = 'hire_conversion') = 1, 'а найм доступен');
set local request.jwt.claim.sub = 'ad000000-0000-0000-0000-0000000000ad';
select throws_ok($$select * from public.analytics_metrics(array[private.default_org_id()], current_date - 30, current_date)$$, '42501', null, 'Админу аналитика недоступна');
select throws_ok($$select * from public.analytics_records(array[private.default_org_id()], 'revenue', current_date - 30, current_date)$$, '42501', null, 'Записи без доступа не отдаются');

select * from finish();
rollback;
