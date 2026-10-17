-- Шаг 26: дашборды отделов.
-- Приёмка из ТЗ (раздел 17): показатели в дашбордах совпадают с метриками и с ручным пересчётом.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(33);

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
insert into auth.users (id, email) values ('c9000000-0000-0000-0000-0000000000c9', 'cu@test.local');
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


insert into public.client_contacts (org_id, client_id, full_name, user_id, cabinet_role)
  values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Контакт заказчика', 'c9000000-0000-0000-0000-0000000000c9', 'client_admin');
update public.assignments set client_rating = 4 where worker_id = pg_temp.w(1) and status = 'worked';
update public.assignments set client_rating = 5 where worker_id = pg_temp.w(2) and status = 'worked';
update public.workers set created_at = now() - interval '20 days' where user_id = pg_temp.w(5);
insert into public.candidates (id, org_id, full_name, stage, created_at) values
  ('ca000000-0000-0000-0000-000000000001', private.default_org_id(), 'Принятый', 'admitted', now() - interval '5 days'),
  ('ca000000-0000-0000-0000-000000000002', private.default_org_id(), 'Другой', 'interview', now() - interval '3 days'),
  ('ca000000-0000-0000-0000-000000000003', private.default_org_id(), 'Третий', 'interview', now() - interval '1 day');
-- Прошлый период: выше маржа у того же заказчика
insert into public.analytics_daily (org_id, day, client_id, site_id, revenue, worker_costs, margin)
  values (private.default_org_id(), current_date - 45, 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', 1000, 500, 500);

set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';

-- Заказчики
select is((select revenue from public.analytics_by_client(array[private.default_org_id()], current_date - 30, current_date)), 9000.00, 'Выручка заказчика совпадает с начислениями');
select is((select margin_falling from public.analytics_by_client(array[private.default_org_id()], current_date - 30, current_date)), true, 'Падающая маржа: 50% в прошлом периоде, меньше в этом');
select is((select prev_margin_pct from public.analytics_by_client(array[private.default_org_id()], current_date - 30, current_date)), 50.0, 'и прошлая маржинальность показана');

-- Объекты
select is((select needed from public.analytics_by_site(array[private.default_org_id()], current_date - 120, current_date + 10) where site_name = 'Склад 1'), 6::bigint, 'Объект: нужно 6 человек за период');
select is((select confirmed from public.analytics_by_site(array[private.default_org_id()], current_date - 120, current_date + 10) where site_name = 'Склад 1'), 4::bigint, 'подтвердили 4 — как в метрике укомплектованности');
select is((select week_needed from public.analytics_by_site(array[private.default_org_id()], current_date - 120, current_date + 10) where site_name = 'Склад 1'), 2::bigint, 'На неделе вперёд нужно 2 человека');
select is((select week_confirmed from public.analytics_by_site(array[private.default_org_id()], current_date - 120, current_date + 10) where site_name = 'Склад 1'), 1::bigint, 'подтвердил один');
select is((select today_needed from public.analytics_by_site(array[private.default_org_id()], current_date - 120, current_date + 10) where site_name = 'Склад 1'), 0::bigint, 'На сегодня смен нет');

-- Не подтвердившие
reset role;
update public.assignments set status = 'assigned' where shift_start::date > current_date;
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select is((select count(*)::int from public.analytics_unconfirmed(array[private.default_org_id()], current_date + 5)), 1, 'Не подтвердил выход один человек');
select is((select worker_name from public.analytics_unconfirmed(array[private.default_org_id()], current_date + 5) limit 1) is not null, true, 'и он назван в списке');
select is((select value from public.analytics_counters(array[private.default_org_id()], current_date - 30, current_date) where key = 'unconfirmed_tomorrow'), 0::numeric, 'На завтра неподтвердивших нет');

-- Счётчики
select is((select value from public.analytics_counters(array[private.default_org_id()], current_date - 30, current_date) where key = 'rating_avg'), 4.50, 'Средняя оценка 4,5');
select is((select value from public.analytics_counters(array[private.default_org_id()], current_date - 30, current_date) where key = 'unbilled_accruals'), 9000.00, 'Невыставленные начисления 9 000');
select is((select value from public.analytics_counters(array[private.default_org_id()], current_date - 30, current_date) where key = 'to_pay'), (select sum(amount_worker) from public.accruals), 'К выплате — затраты на исполнителей по начислениям');
select is((select value from public.analytics_counters(array[private.default_org_id()], current_date - 30, current_date) where key = 'no_shift_14'), 1::numeric, 'Допущен, но без смен 14 дней — один');
select is((select value from public.analytics_counters(array[private.default_org_id()], current_date - 30, current_date) where key = 'idle_clients_30'), 0::numeric, 'Заказчик с недавними сменами не в риске оттока');

-- Кандидаты
select is((select total from public.analytics_candidates(array[private.default_org_id()], current_date - 30, current_date) where dimension = 'source'), 3::bigint, 'Кандидатов периода: 3');
select is((select admitted from public.analytics_candidates(array[private.default_org_id()], current_date - 30, current_date) where dimension = 'source'), 1::bigint, 'допущен один');
select is((select total from public.analytics_candidates(array[private.default_org_id()], current_date - 30, current_date) where dimension = 'stage' and key = 'interview'), 2::bigint, 'На собеседовании двое');

-- План и факт
select public.save_bdr_plan(private.default_org_id(), date_trunc('month', current_date)::date, 'revenue', 30000);
select public.save_bdr_plan(private.default_org_id(), date_trunc('month', current_date)::date, 'worker_costs', 12000);
select is((select revenue_plan from public.analytics_plan_fact(array[private.default_org_id()], date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date)), 30000.00, 'План выручки месяца целиком');
select is((select margin_plan from public.analytics_plan_fact(array[private.default_org_id()], date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date)), 18000.00, 'План маржи — выручка минус затраты на исполнителей');
select is((select revenue_fact from public.analytics_plan_fact(array[private.default_org_id()], current_date - 30, current_date)), (select sum(amount_client) from public.accruals), 'Факт выручки равен сумме начислений');

-- Кабинет заказчика
set local request.jwt.claim.sub = 'c9000000-0000-0000-0000-0000000000c9';
select is((select needed from public.client_dashboard('c1000000-0000-0000-0000-000000000001', current_date - 120, current_date + 10)), 6::bigint, 'Заказчик видит по объекту, сколько людей было нужно');
select is((select hours from public.client_dashboard('c1000000-0000-0000-0000-000000000001', current_date - 120, current_date + 10)), 20.00, 'часы');
select is((select amount from public.client_dashboard('c1000000-0000-0000-0000-000000000001', current_date - 120, current_date + 10)), 9000.00, 'сумма к оплате');
select is((select avg_rating from public.client_dashboard('c1000000-0000-0000-0000-000000000001', current_date - 120, current_date + 10)), 4.50, 'и среднюю оценку своих людей');

-- Права
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000002';
select throws_ok($$select * from public.client_dashboard('c1000000-0000-0000-0000-000000000001', current_date - 30, current_date)$$, '42501', null, 'Посторонний не видит кабинет заказчика');
select is((select count(*)::int from public.analytics_by_client(array[private.default_org_id()], current_date - 120, current_date)), 0, 'Менеджер продаж без заказчиков не видит чужих заказчиков');
select is((select revenue_plan from public.analytics_plan_fact(array[private.default_org_id()], date_trunc('month', current_date)::date, current_date)), null, 'и плана компании');
set local request.jwt.claim.sub = '4e000000-0000-0000-0000-0000000000e1';
select throws_ok($$select * from public.analytics_by_client(array[private.default_org_id()], current_date - 30, current_date)$$, '42501', null, 'Рекрутёру разрез по заказчикам недоступен');
select is((select count(*)::int from public.analytics_counters(array[private.default_org_id()], current_date - 30, current_date) where key = 'unbilled_accruals'), 0, 'и невыставленные начисления тоже');
select is((select count(*)::int from public.analytics_candidates(array[private.default_org_id()], current_date - 30, current_date)) > 0, true, 'а кандидаты доступны');
set local request.jwt.claim.sub = 'ad000000-0000-0000-0000-0000000000ad';
select throws_ok($$select * from public.analytics_counters(array[private.default_org_id()], current_date - 30, current_date)$$, '42501', null, 'Админу счётчики недоступны');

select * from finish();
rollback;
