-- Шаг 23: платёжный календарь.
-- Приёмка из ТЗ (раздел 16): календарь показывает разрыв, когда выплаты недели больше остатка и ожидаемых оплат.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('ac000000-0000-0000-0000-0000000000ac', 'acc@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 4) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'site_manager' where user_id = '5c000000-0000-0000-0000-0000000000c1';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
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
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.7682, 55.097, 'geo');
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 400, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
update public.workers set tax_status = 'ip' where user_id in (select pg_temp.w(i) from generate_series(1, 4) i);
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from generate_series(1, 4) i, public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
update public.cash_accounts set opening_balance = 5000, opening_date = current_date - 30 where org_id = private.default_org_id() and kind = 'bank';
-- Выплаты по расписанию — в день недели «сегодня + 2»
insert into public.org_settings (org_id, key, value) values (private.default_org_id(), 'payout.weekday', to_jsonb(extract(isodow from current_date + 2)::int));

-- Три человека отработали 10 дней назад: к выплате 9 000, заказчику 13 500 (счёт ещё не выставлен)
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select o.id, private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id, current_date + o.d, current_date + o.d, '08:00', '19:00', o.n, 0, 60
  from public.positions p join (values ('a1000000-0000-0000-0000-000000000001'::uuid, 2, 3), ('a2000000-0000-0000-0000-000000000002'::uuid, 3, 1)) o(id, d, n) on true
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order(id) from public.orders;
select public.assign_workers((select array_agg(s.id) from public.shifts s where s.order_id = 'a1000000-0000-0000-0000-000000000001'), array[pg_temp.w(1), pg_temp.w(2), pg_temp.w(3)]);
select public.assign_workers((select array_agg(s.id) from public.shifts s where s.order_id = 'a2000000-0000-0000-0000-000000000002'), array[pg_temp.w(4)]);
reset role;
update public.assignments a set status = 'worked', planned_hours = 10, approved_hours = 10 from public.shifts s where s.id = a.shift_id and s.order_id = 'a1000000-0000-0000-0000-000000000001';
select private.create_accrual_for_assignment(a.id) from public.assignments a join public.shifts s on s.id = a.shift_id where s.order_id = 'a1000000-0000-0000-0000-000000000001';
update public.accruals set shift_date = current_date - 10;

set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
create temp table cal as select * from public.payment_calendar(private.default_org_id(), current_date, 28);
grant select on cal to authenticated;
select is((select count(*)::int from cal), 28, 'Календарь на 28 дней');
select is((select balance_open from cal where day = current_date), 5000.00, 'Остаток на начало — деньги на счетах, 5 000');
select is((select out_accrued from cal where day = current_date + 2), 9000.00, 'В день выплат уходит начисленное к выплате: 9 000');
select is((select closing from (select balance_close as closing from cal where day = current_date + 2) x), -4000.00, 'Остаток после выплат −4 000');
select is((select gap from cal where day = current_date + 2), true, 'Кассовый разрыв подсвечен');
select is((select in_plan from cal where day = current_date + 7), 13500.00, 'Поступление по ещё не выставленному: смена + неделя + 10 дней отсрочки = через 7 дней, 13 500');
select is((select balance_close from cal where day = current_date + 7), 9500.00, 'после поступления остаток 9 500');
select is((select gap from cal where day = current_date + 7), false, 'и разрыва нет');
select is((select min(day) from cal where gap), current_date + 2, 'Разрыв начинается в день выплат');
select is((select max(day) from cal where gap), current_date + 6, 'и длится до поступления');

-- Будущая смена, по которой начисления ещё нет: ожидаемая выручка и будущая выплата следующей недели
select is((select out_plan from cal where day = current_date + 9), 3000.00, 'Смена через 3 дня даёт плановую выплату 3 000 в следующую дату выплат');
select is((select in_plan from cal where day = current_date + 20), 4500.00, 'и плановое поступление 4 500 через 20 дней');

-- Плановая статья вручную
insert into public.planned_cash_items (org_id, item_date, direction, amount, title) values (private.default_org_id(), current_date + 3, 'out', 1000, 'Аренда');
select is((select out_manual from public.payment_calendar(private.default_org_id(), current_date, 28) where day = current_date + 3), 1000.00, 'Плановая аренда 1 000 видна');
select is((select balance_close from public.payment_calendar(private.default_org_id(), current_date, 28) where day = current_date + 7), 8500.00, 'и уменьшает остаток');

-- Выставленный счёт: поступление переходит на дату оплаты по счёту
create temp table act as select public.generate_client_documents('c1000000-0000-0000-0000-000000000001', current_date - 30, current_date - 10) as id;
select public.issue_client_documents((select id from act));
select is((select in_invoices from public.payment_calendar(private.default_org_id(), current_date, 28) where day = current_date + 10), 13500.00, 'После выставления счёта поступление — на дату оплаты, +10 дней');
select is((select in_plan from public.payment_calendar(private.default_org_id(), current_date, 28) where day = current_date + 7), 0::numeric, 'и из плана по невыставленному уходит');
select is((select max(day) from public.payment_calendar(private.default_org_id(), current_date, 28) where gap and day < current_date + 12), current_date + 9, 'Разрыв удлинился до оплаты по счёту');

-- Просроченный счёт ждём с первого дня
reset role;
update public.client_documents set due_date = current_date - 5 where kind = 'invoice';
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select in_invoices from public.payment_calendar(private.default_org_id(), current_date, 28) where day = current_date), 13500.00, 'Просроченный счёт ожидается с первого дня календаря');

-- Доступ и границы
select throws_ok($$select * from public.payment_calendar(private.default_org_id(), current_date, 0)$$, '22023', null, 'Горизонт обязан быть положительным');
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select * from public.payment_calendar(private.default_org_id())$$, '42501', null, 'Продавцу календарь недоступен');
select is((select count(*)::int from public.planned_cash_items), 0, 'и плановые статьи тоже');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select ok((select count(*) from public.payment_calendar(private.default_org_id())) = 28, 'Руководитель видит календарь');

select * from finish();
rollback;
