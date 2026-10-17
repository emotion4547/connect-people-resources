-- Приёмка этапа 3 (ТЗ, раздел 20): выручка БДР за месяц равна начислениям «к выставлению»; остаток ДДС совпадает с банком на дату выписки;
-- платёжный календарь показывает разрыв; укомплектованность и маржа на дашбордах руководителя и отдела совпадают друг с другом и с ручным
-- пересчётом по записям; выигранная сделка создаёт тарифы из КП; импорт 500 исполнителей с 10 ошибками загружает 490; исполнитель с истёкшей
-- медкнижкой не назначается на склад с таким требованием.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(27);

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('ac000000-0000-0000-0000-0000000000ac', 'acc@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('4e000000-0000-0000-0000-0000000000e1', 'rec@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 4) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'site_manager' where user_id = '5c000000-0000-0000-0000-0000000000c1';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
update public.user_roles set role = 'recruiter' where user_id = '4e000000-0000-0000-0000-0000000000e1';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales'),
  ('4e000000-0000-0000-0000-0000000000e1', 'Рекрутер', 'hiring');
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
-- Склад требует медицинскую книжку: у W4 она истекла
insert into public.site_required_documents (org_id, site_id, document_type_id)
  select private.default_org_id(), '51e00000-0000-0000-0000-000000000001', id from public.directories
  where org_id = private.default_org_id() and kind = 'document_type' and name = 'Медицинская книжка';
insert into public.worker_documents (org_id, worker_id, document_type_id, status, valid_until)
  select private.default_org_id(), pg_temp.w(i), d.id, 'verified', case when i = 4 then current_date - 1 else current_date + 365 end
  from generate_series(1, 4) i, public.directories d where d.org_id = private.default_org_id() and d.kind = 'document_type' and d.name = 'Медицинская книжка';
update public.cash_accounts set opening_balance = 100000, opening_date = current_date - 60 where org_id = private.default_org_id() and kind = 'bank';
insert into public.org_settings (org_id, key, value) values (private.default_org_id(), 'payout.weekday', to_jsonb(extract(isodow from current_date + 2)::int));

-- 1. Допуск: исполнитель с истёкшей медкнижкой не назначается
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select 'a1000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id, current_date + 2, current_date + 2, '08:00', '19:00', 3, 0, 60
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order('a1000000-0000-0000-0000-000000000001');
select is((select result from public.assign_workers((select array_agg(id) from public.shifts), array[pg_temp.w(4)])), 'rejected', 'Исполнитель с истёкшей медкнижкой не назначается на склад с таким требованием');
select is((select count(*)::int from public.assign_workers((select array_agg(id) from public.shifts), array[pg_temp.w(1), pg_temp.w(2), pg_temp.w(3)]) where result = 'assigned'), 3, 'Трое с действующими книжками назначены');

-- Документ у первого истёк позже назначения: смена под угрозой
reset role;
update public.worker_documents set valid_until = current_date + 1 where worker_id = pg_temp.w(1);
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select is((select count(*)::int from public.document_conflicts(private.default_org_id(), current_date, current_date + 30)), 1, 'Назначенный, у которого документ истёк до смены, попал в «смены под угрозой»');
reset role;
update public.worker_documents set valid_until = current_date + 365 where worker_id = pg_temp.w(1);

-- Смена прошла 10 дней назад: все отработали по 10 часов, начислено 13 500 заказчику и 9 000 исполнителям
update public.shifts set shift_date = current_date - 10, start_at = (current_date - 10 + time '08:00')::timestamptz, end_at = (current_date - 10 + time '19:00')::timestamptz;
update public.assignments a set shift_start = s.start_at, shift_end = s.end_at from public.shifts s where s.id = a.shift_id;
update public.assignments set status = 'worked', planned_hours = 10, approved_hours = 10;
select private.create_accrual_for_assignment(id) from public.assignments;
update public.accruals set shift_date = current_date - 10, period_month = date_trunc('month', current_date - 10)::date;
create temp table m as select date_trunc('month', current_date - 10)::date as month, (date_trunc('month', current_date - 10) + interval '1 month - 1 day')::date as last_day;
grant select on m to authenticated;

-- 2. БДР: выручка равна начислениям «к выставлению» за месяц
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select fact from public.bdr_report(array[private.default_org_id()], (select month from m), (select last_day from m)) where article = 'revenue'), (select sum(amount_client) from public.accruals where status <> 'draft'), 'Выручка БДР за месяц равна сумме начислений за этот месяц');
select is((select fact from public.bdr_report(array[private.default_org_id()], (select month from m), (select last_day from m)) where article = 'revenue'), 13500.00, 'это 13 500');
select is((select fact from public.bdr_report(array[private.default_org_id()], (select month from m), (select last_day from m)) where article = 'worker_costs'), 9000.00, 'а затраты на исполнителей — 9 000');

-- 3. ДДС: остаток совпадает с банком на дату выписки
create temp table bank as select id from public.cash_accounts where kind = 'bank' and org_id = private.default_org_id();
grant select on bank to authenticated;
select public.import_cashflow_statement(private.default_org_id(), (select id from bank), 'kl.txt', jsonb_build_array(
  jsonb_build_object('date', current_date - 1, 'direction', 'in', 'amount', 50000, 'number', '15', 'counterparty_inn', '5612345678', 'counterparty_name', 'ООО Заказчик 1', 'purpose', 'Оплата по счёту'),
  jsonb_build_object('date', current_date - 1, 'direction', 'out', 'amount', 20000, 'number', '31', 'counterparty_inn', '5600000001', 'counterparty_name', 'ИП Арендодатель', 'purpose', 'Аренда офиса')));
select is((select balance from public.cash_balances(private.default_org_id(), current_date - 1) where account_id = (select id from bank)), 130000.00, 'Остаток в ДДС на дату выписки 130 000 = остаток в выписке банка: 100 000 + 50 000 − 20 000');
select is(public.cash_total_balance(array[private.default_org_id()], current_date - 1), 130000.00, 'Общий остаток денег тот же');
select is((select count(*)::int from public.import_cashflow_statement(private.default_org_id(), (select id from bank), 'kl.txt', jsonb_build_array(jsonb_build_object('date', current_date - 1, 'direction', 'in', 'amount', 50000, 'number', '15', 'counterparty_inn', '5612345678', 'purpose', 'Оплата по счёту'))) as r), 1, 'Повторная загрузка той же выписки возвращает отчёт');
select is((select balance from public.cash_balances(private.default_org_id(), current_date - 1) where account_id = (select id from bank)), 130000.00, 'и не меняет остаток');

-- 4. Платёжный календарь: разрыв, когда плановые платежи больше остатка
insert into public.planned_cash_items (org_id, item_date, direction, amount, title) values (private.default_org_id(), current_date + 3, 'out', 150000, 'Налоги и взносы за квартал');
create temp table cal as select * from public.payment_calendar(private.default_org_id(), current_date, 28);
grant select on cal to authenticated;
select is((select out_accrued from cal where day = current_date + 2), 9000.00, 'В день выплат уходит начисленное исполнителям — 9 000');
select is((select gap from cal where day = current_date + 3), true, 'После платежа на 150 000 остатка не хватает — календарь показывает разрыв');
select is((select min(day) from cal where gap), current_date + 3, 'Разрыв начинается в день платежа');
select is((select balance_close from cal where day = current_date + 3), -29000.00, 'глубина разрыва 29 000: 130 000 − 9 000 − 150 000');

-- 5. Дашборды сходятся друг с другом и с ручным пересчётом
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
create temp table dir as select * from public.analytics_metrics(array[private.default_org_id()], current_date - 30, current_date + 10);
grant select on dir to authenticated;
select is((select value from dir where metric = 'staffing'), 100.0, 'Укомплектованность у руководителя: подтвердили 3 из 3');
select is((select value from dir where metric = 'margin_amount'), (select sum(margin) from public.accruals), 'Маржа у руководителя равна сумме маржи начислений (ручной пересчёт)');
select is((select sum(amount) from public.analytics_records(array[private.default_org_id()], 'margin_amount', current_date - 30, current_date + 10)), (select value from dir where metric = 'margin_amount'), 'Маржа равна сумме записей, из которых сложилась');
select is((select sum(amount) from public.analytics_records(array[private.default_org_id()], 'staffing', current_date - 30, current_date + 10)), (select num from dir where metric = 'staffing'), 'Укомплектованность — сумме записей по сменам');
select is((select revenue from public.analytics_by_client(array[private.default_org_id()], current_date - 30, current_date + 10)), (select value from dir where metric = 'revenue'), 'Выручка по заказчику равна выручке в карточках руководителя');
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select is((select value from public.analytics_metrics(array[private.default_org_id()], current_date - 30, current_date + 10) where metric = 'margin_amount'), (select value from dir where metric = 'margin_amount'), 'Маржа у менеджера продаж (по своему заказчику) та же, что у руководителя');
select is((select value from public.analytics_metrics(array[private.default_org_id()], current_date - 30, current_date + 10) where metric = 'staffing'), (select value from dir where metric = 'staffing'), 'и укомплектованность та же');
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select is((select value from public.analytics_metrics(array[private.default_org_id()], current_date - 30, current_date + 10) where metric = 'staffing'), (select value from dir where metric = 'staffing'), 'У менеджера объектов укомплектованность та же');

-- 6. Воронка: выигранная сделка создаёт тарифы из КП
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
insert into public.deals (org_id, title, company, contact_name, owner_id, expected_revenue) values
  (private.default_org_id(), 'Фабрика-Плюс', 'Фабрика-Плюс', 'Мария', '51000000-0000-0000-0000-000000000001', 200000);
select public.create_deal_quote((select id from public.deals where title = 'Фабрика-Плюс'),
  jsonb_build_array(jsonb_build_object('position_id', (select id from public.positions where name = 'Грузчик' limit 1), 'unit', 'hour', 'client_rate', 480, 'worker_rate', 310, 'headcount', 5, 'hours_per_month', 800),
                    jsonb_build_object('position_id', (select id from public.positions where name = 'Кладовщик' limit 1), 'unit', 'hour', 'client_rate', 520, 'worker_rate', 350, 'headcount', 1, 'hours_per_month', 160)));
select is(public.win_deal((select id from public.deals where title = 'Фабрика-Плюс')), 2, 'Выигранная сделка создаёт тарифы по строкам КП');
select is((select count(*)::int from public.tariffs t join public.clients c on c.id = t.client_id where c.name = 'Фабрика-Плюс' and t.status = 'draft' and t.client_rate in (480, 520) and t.worker_rate in (310, 350)), 2, 'Ставки перенесены без повторного ввода');

-- 7. Импорт: 500 исполнителей с 10 ошибками — загружено 490
set local request.jwt.claim.sub = '4e000000-0000-0000-0000-0000000000e1';
create temp table rows500 as
  select jsonb_agg(case when i % 50 = 0 then jsonb_build_object('full_name', 'Кандидат ' || i, 'phone', 'нет номера')
                        else jsonb_build_object('full_name', 'Кандидат ' || i, 'phone', '+7900' || lpad(i::text, 7, '0'), 'city', 'Оренбург') end) as rows
  from generate_series(1, 500) i;
grant select on rows500 to authenticated;
create temp table imp as select * from public.import_rows(private.default_org_id(), 'candidates', (select rows from rows500), true);
select is((select count(*)::int from imp where result = 'created'), 490, 'Импорт 500 строк загрузил 490');
select is((select count(*)::int from imp where result = 'error' and message is not null), 10, 'и показал 10 строк с причинами');
select is((select count(*)::int from public.candidates), 490, 'В базе 490 кандидатов');

select * from finish();
rollback;
