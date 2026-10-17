-- Шаг 21: счета денег и операции ДДС.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(28);
set local app.pii_key = 'test-key-0123456789abcdef0123456789abcdef';

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('ac000000-0000-0000-0000-0000000000ac', 'acc@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local');
insert into auth.users (id, email) values (pg_temp.w(1), 'w1@test.local');
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'site_manager' where user_id = '5c000000-0000-0000-0000-0000000000c1';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');

-- Начальные данные организации
select is((select count(*)::int from public.cash_accounts where org_id = private.default_org_id()), 3, 'У организации три счёта: расчётный, платформа выплат, касса');
select ok((select count(*)::int from public.cashflow_categories where org_id = private.default_org_id()) >= 12, 'Заведены статьи ДДС');
select is((select count(*)::int from public.cashflow_categories where org_id = private.default_org_id() and bdr_article = 'revenue'), 1, 'Оплата заказчиков связана со статьёй БДР «Выручка»');

update public.cash_accounts set opening_balance = 100000, opening_date = current_date - 60 where org_id = private.default_org_id() and kind = 'bank';

insert into public.clients (id, org_id, name, inn, sales_manager_id, sites_manager_id, status) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '5612345678', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active');
insert into public.sites (id, name, client_id, site_manager_id, status, latitude, longitude, checkin_method) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.7682, 55.097, 'geo');
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 400, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
update public.workers set tax_status = 'self_employed', full_name = 'Петров Пётр' where user_id = pg_temp.w(1);
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(1), p.id from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';

-- ------------------------------------------------------------
-- Оплата заказчика создаёт поступление сама
-- ------------------------------------------------------------
insert into public.client_payments (id, org_id, client_id, payment_date, amount, source, doc_number, payer_name, purpose)
  values ('9a000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', current_date - 10, 50000, 'manual', '1', 'ООО Заказчик 1', 'Оплата по счёту');
select is((select direction || '/' || amount from public.cashflow_entries where basis_type = 'client_payment'), 'in/50000.00', 'Оплата заказчика — поступление на 50 000');
select is((select c.code from public.cashflow_entries e join public.cashflow_categories c on c.id = e.category_id where e.basis_type = 'client_payment'), 'client_payment', 'со статьёй «Оплата заказчиков»');
select is((select a.kind from public.cashflow_entries e join public.cash_accounts a on a.id = e.account_id where e.basis_type = 'client_payment'), 'bank', 'на расчётный счёт');

-- ------------------------------------------------------------
-- Проведённая выплата создаёт расход и комиссию платформы
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select 'a1000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
         current_date + 2, current_date + 2, '08:00', '19:00', 1, 0, 60
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order('a1000000-0000-0000-0000-000000000001');
select public.assign_workers((select array_agg(id) from public.shifts), array[pg_temp.w(1)]);
reset role;
update public.assignments set status = 'worked', planned_hours = 10, approved_hours = 10;
select private.create_accrual_for_assignment(id) from public.assignments;
update public.accruals set shift_date = current_date - 5;
update public.workers set npd_status = 'active', npd_checked_at = now() where user_id = pg_temp.w(1);
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select public.submit_payout_requisites(pg_temp.w(1), 'platform', '+79000000001');
select public.build_payout_registries(private.default_org_id(), current_date - 30, current_date);
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select public.confirm_payout_registry(id) from public.payout_registries;
reset role;
select private.mark_line_paid((select id from public.payout_lines), 'plat-1', 'чек');
select is((select amount || '/' || direction from public.cashflow_entries where basis_type = 'payout_line'), '3000.00/out', 'Выплата самозанятому — расход 3 000');
select is((select a.kind from public.cashflow_entries e join public.cash_accounts a on a.id = e.account_id where e.basis_type = 'payout_line'), 'platform', 'со счёта платформы выплат');
select is((select amount from public.cashflow_entries where basis_type = 'payout_fee'), 60.00, 'Комиссия платформы 2% — отдельный расход 60');
select is((select count(*)::int from public.cashflow_entries where source = 'auto'), 3, 'Всего три автоматические операции');
-- повторное проведение той же строки ничего не добавляет
update public.payout_lines set status = 'pending'; update public.payout_lines set status = 'paid';
select is((select count(*)::int from public.cashflow_entries where source = 'auto'), 3, 'Одно основание — одна операция');

-- ------------------------------------------------------------
-- Ручные операции и перемещения
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
create temp table accs as select id, kind from public.cash_accounts where org_id = private.default_org_id();
grant select on accs to authenticated;
select lives_ok($$select public.add_cashflow_entry(private.default_org_id(), (select id from accs where kind = 'bank'), current_date - 3, 'out', 20000,
  (select id from public.cashflow_categories where code = 'rent' and org_id = private.default_org_id()), 'ИП Арендодатель', 'Аренда за месяц', 'x/y.pdf')$$, 'Бухгалтер вносит аренду вручную');
select throws_ok($$select public.add_cashflow_entry(private.default_org_id(), (select id from accs where kind = 'bank'), current_date, 'in', 100,
  (select id from public.cashflow_categories where code = 'rent' and org_id = private.default_org_id()))$$, '22023', null, 'Статья расхода к поступлению не подходит');
select throws_ok($$select public.add_cashflow_entry(private.default_org_id(), (select id from accs where kind = 'bank'), current_date, 'out', 0, null)$$, '22023', null, 'Нулевая сумма не принимается');
select lives_ok($$select public.transfer_cash(private.default_org_id(), (select id from accs where kind = 'bank'), (select id from accs where kind = 'platform'), current_date - 4, 5000, 'Пополнение платформы')$$, 'Пополнение баланса платформы выплат');
select is((select count(*)::int from public.cashflow_entries where transfer_group is not null), 2, 'Перемещение — две связанные операции');

-- Остатки на дату
select is((select balance from public.cash_balances(private.default_org_id(), current_date) where kind = 'bank'), 125000.00, 'Расчётный счёт: 100 000 + 50 000 − 20 000 − 5 000 = 125 000');
select is((select balance from public.cash_balances(private.default_org_id(), current_date) where kind = 'platform'), 1940.00, 'Платформа: 5 000 − 3 000 − 60 = 1 940');
select is((select balance from public.cash_balances(private.default_org_id(), current_date - 20) where kind = 'bank'), 100000.00, 'Остаток на прошлую дату не включает поздние операции');

-- Разнесение и удаление
select lives_ok($$select public.set_entry_category((select id from public.cashflow_entries where comment = 'Аренда за месяц'), (select id from public.cashflow_categories where code = 'advertising' and org_id = private.default_org_id()))$$, 'Статью операции можно сменить');
select throws_ok($$select public.set_entry_category((select id from public.cashflow_entries where transfer_group is not null limit 1), (select id from public.cashflow_categories where code = 'rent' and org_id = private.default_org_id()))$$, '22023', null, 'Статью перемещения менять нельзя');
select throws_ok($$select public.delete_cashflow_entry((select id from public.cashflow_entries where basis_type = 'client_payment'))$$, '22023', null, 'Автоматическую операцию удалить нельзя');
select lives_ok($$select public.delete_cashflow_entry((select id from public.cashflow_entries where comment = 'Аренда за месяц'))$$, 'Ручную можно');
select lives_ok($$select public.delete_cashflow_entry((select id from public.cashflow_entries where transfer_group is not null limit 1))$$, 'Перемещение удаляется целиком');
select is((select count(*)::int from public.cashflow_entries where transfer_group is not null), 0, 'обе его операции исчезли');

-- Доступ
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.cashflow_entries), 0, 'Продавец операций не видит');
select throws_ok($$select * from public.cash_balances(private.default_org_id())$$, '42501', null, 'и остатков тоже');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select ok((select count(*) from public.cashflow_entries) >= 3, 'Руководитель видит операции');

select * from finish();
rollback;
