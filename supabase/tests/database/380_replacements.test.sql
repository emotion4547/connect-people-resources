-- Счётчик замен на дашборде ведения объектов: выбывший исполнитель и новый, назначенный позже на ту же смену.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(3);

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

insert into auth.users (id, email) values ('d1000000-0000-0000-0000-00000000000d', 'd@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 3) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
insert into public.staff_profiles (user_id, full_name, department) values ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management');
insert into public.clients (id, org_id, name, status) values ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик', 'active');
insert into public.sites (id, name, client_id, status, latitude, longitude, checkin_method) values ('51e00000-0000-0000-0000-000000000001', 'Склад', 'c1000000-0000-0000-0000-000000000001', 'active', 51.7, 55.1, 'manual');
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 400, 'approved' from public.positions p where p.org_id = private.default_org_id();
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, status)
  select 'a1000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id, current_date - 3, current_date - 3, '08:00', '17:00', 1, 'accepted'
  from public.positions p where p.org_id = private.default_org_id() limit 1;
insert into public.shifts (id, org_id, order_id, client_id, site_id, position_id, shift_date, start_at, end_at, headcount, status)
  select 'b1000000-0000-0000-0000-000000000001', private.default_org_id(), 'a1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', o.position_id,
         current_date - 3, (current_date - 3 + time '08:00')::timestamptz, (current_date - 3 + time '17:00')::timestamptz, 1, 'completed' from public.orders o where o.id = 'a1000000-0000-0000-0000-000000000001';
-- Первый не вышел (запись изменена вчера), второго назначили после этого
insert into public.assignments (org_id, shift_id, worker_id, status, shift_start, shift_end, created_at, updated_at)
  select private.default_org_id(), 'b1000000-0000-0000-0000-000000000001', pg_temp.w(1), 'no_show', s.start_at, s.end_at, now() - interval '5 days', now() - interval '2 days' from public.shifts s where s.id = 'b1000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select is((select value from public.analytics_counters(array[private.default_org_id()], current_date - 10, current_date) where key = 'replacements'), 0::numeric, 'Пока замены не было — ноль');
reset role;
insert into public.assignments (org_id, shift_id, worker_id, status, shift_start, shift_end, created_at, updated_at)
  select private.default_org_id(), 'b1000000-0000-0000-0000-000000000001', pg_temp.w(2), 'worked', s.start_at, s.end_at, now() - interval '1 day', now() - interval '1 day' from public.shifts s where s.id = 'b1000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select is((select value from public.analytics_counters(array[private.default_org_id()], current_date - 10, current_date) where key = 'replacements'), 1::numeric, 'Выбывшего заменили позже назначенным — одна замена');
select is((select value from public.analytics_counters(array[private.default_org_id()], current_date - 10, current_date - 5) where key = 'replacements'), 0::numeric, 'Смены вне периода не считаются');

select * from finish();
rollback;
