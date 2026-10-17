-- Шаг 24: БДР — факт, план, план/факт.
-- Приёмка из ТЗ (раздел 16): выручка БДР за месяц совпадает с суммой начислений «к выставлению» за тот же месяц.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(28);

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
update public.cash_accounts set opening_balance = 50000, opening_date = current_date - 60 where org_id = private.default_org_id() and kind = 'bank';

-- Три человека отработали 10 дней назад: выручка 13 500, исполнителям 9 000
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select 'a1000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id, current_date + 2, current_date + 2, '08:00', '19:00', 3, 0, 60
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order('a1000000-0000-0000-0000-000000000001');
select public.assign_workers((select array_agg(s.id) from public.shifts s where s.order_id = 'a1000000-0000-0000-0000-000000000001'), array[pg_temp.w(1), pg_temp.w(2), pg_temp.w(3)]);
reset role;
update public.assignments a set status = 'worked', planned_hours = 10, approved_hours = 10 from public.shifts s where s.id = a.shift_id and s.order_id = 'a1000000-0000-0000-0000-000000000001';
select private.create_accrual_for_assignment(a.id) from public.assignments a join public.shifts s on s.id = a.shift_id where s.order_id = 'a1000000-0000-0000-0000-000000000001';
update public.accruals set shift_date = current_date - 10, period_month = date_trunc('month', current_date - 10)::date;
create temp table m as select date_trunc('month', current_date - 10)::date as month, (date_trunc('month', current_date - 10) + interval '1 month - 1 day')::date as last_day;
grant select on m to authenticated;

-- Чистые функции
select is(private.accrual_date('main', date '2026-03-10', date '2026-04-01'), date '2026-03-10', 'Основное начисление относится к дате смены');
select is(private.accrual_date('correction', date '2026-03-10', date '2026-04-01'), date '2026-04-01', 'Корректировка — к месяцу, в котором её оформили');
select is(private.estimate_tax('usn6', 1000, 400), 60.00, 'УСН «доходы»: 6% от выручки');
select is(private.estimate_tax('usn15', 1000, 400), 90.00, 'УСН «доходы минус расходы»: 15% от разницы');
select is(private.estimate_tax('usn15', 1000, 990), 10.00, 'и не меньше 1% выручки');
select is(private.estimate_tax('osno', 1000, 400), 120.00, 'Общая система: 20% от прибыли');

-- Выручка БДР = сумма начислений «к выставлению» за месяц
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
create temp table rep as select r.* from m, public.bdr_report(array[private.default_org_id()], m.month, m.last_day) r;
grant select on rep to authenticated;
select is((select fact from rep where article = 'revenue'), (select sum(amount_client) from public.accruals where status <> 'draft'), 'Выручка БДР равна сумме начислений за месяц');
select is((select fact from rep where article = 'revenue'), 13500.00, 'и это 13 500');
select is((select fact from rep where article = 'worker_costs'), 9000.00, 'Затраты на исполнителей 9 000');
select is((select fact from rep where article = 'operating_profit'), (select sum(amount_client - amount_worker - taxes - payout_fee) from public.accruals), 'Операционная прибыль считается как разница');
select is((select fact from rep where article = 'usn_tax'), round(13500 * 0.06, 2), 'Налог по УСН 6% от выручки');
select is((select fact from rep where article = 'net_profit'), (select fact from rep where article = 'operating_profit') - (select fact from rep where article = 'usn_tax'), 'Чистая прибыль — после налога');

-- Прочие расходы берутся из ДДС по статье, перемещения не учитываются
select public.add_cashflow_entry(private.default_org_id(), (select id from public.cash_accounts where kind = 'bank'), (select month from m) + 5, 'out', 2000,
  (select id from public.cashflow_categories where code = 'rent'));
select public.transfer_cash(private.default_org_id(), (select id from public.cash_accounts where kind = 'bank'), (select id from public.cash_accounts where kind = 'cash'), (select month from m) + 5, 500);
select is((select fact from public.bdr_report(array[private.default_org_id()], (select month from m), (select last_day from m)) where article = 'admin_costs'), 2000.00, 'Аренда из ДДС попала в управленческие расходы');
select is((select count(*)::int from public.bdr_report(array[private.default_org_id()], (select month from m), (select last_day from m)) where article = 'other_staff_costs'), 0, 'Перемещение между счетами в БДР не попадает');

-- План и план/факт
select public.save_bdr_plan(private.default_org_id(), (select month from m) + 9, 'revenue', 12000, 'c1000000-0000-0000-0000-000000000001');
select public.save_bdr_plan(private.default_org_id(), (select month from m), 'revenue', 8000);
select public.save_bdr_plan(private.default_org_id(), (select month from m), 'revenue', 8000);
select is((select plan from public.bdr_report(array[private.default_org_id()], (select month from m), (select last_day from m)) where article = 'revenue'), 20000.00, 'План выручки: строка заказчика плюс общая, повтор сохранения не дублирует');
select is((select count(*)::int from public.bdr_plans where article = 'revenue'), 2, 'Повторное сохранение обновляет строку');
select is((select plan from public.bdr_report(array[private.default_org_id()], (select month from m), (select last_day from m)) where article = 'usn_tax'), 1200.00, 'Налог в плане считается от плановой выручки');

-- Разрезы
select is((select revenue from public.bdr_breakdown(array[private.default_org_id()], (select month from m), (select last_day from m), 'client')), 13500.00, 'Разрез по заказчику: выручка 13 500');
select is((select margin_pct from public.bdr_breakdown(array[private.default_org_id()], (select month from m), (select last_day from m), 'client')), round((13500 - 9000) / 13500.0 * 100, 1), 'и маржинальность в процентах');
select is((select name from public.bdr_breakdown(array[private.default_org_id()], (select month from m), (select last_day from m), 'manager')), 'Продавец', 'Разрез по менеджеру продаж');
select is((select name from public.bdr_breakdown(array[private.default_org_id()], (select month from m), (select last_day from m), 'site')), 'Склад 1', 'Разрез по объекту');
select throws_ok($$select * from public.bdr_breakdown(array[private.default_org_id()], current_date - 30, current_date, 'planet')$$, '22023', null, 'Неизвестный разрез отвергается');

-- Копирование факта прошлого года с ростом
select ok(public.copy_bdr_plan(private.default_org_id(), extract(year from current_date - 10)::int, extract(year from current_date - 10)::int + 1, 10) > 0, 'Копирование плана создаёт строки');
select is((select amount from public.bdr_plans where article = 'revenue' and month = (select month from m) + interval '1 year' and client_id is not null), 14850.00, 'Выручка по заказчику с ростом 10%');
select throws_ok($$select public.copy_bdr_plan(private.default_org_id(), 2027, 2026, 0)$$, '22023', null, 'Год плана должен быть позже базового');
select throws_ok($$select public.save_bdr_plan(private.default_org_id(), current_date, 'revenue', -5)$$, '22023', null, 'Отрицательный план отвергается');

-- Доступ
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select * from public.bdr_report(array[private.default_org_id()], current_date - 30, current_date)$$, '42501', null, 'Продавцу БДР недоступен');
select throws_ok($$select public.save_bdr_plan(private.default_org_id(), current_date, 'revenue', 1)$$, '42501', null, 'и править план он не может');

select * from finish();
rollback;
