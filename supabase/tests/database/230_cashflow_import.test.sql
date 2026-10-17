-- Шаг 22: импорт выписки по всем операциям, правила разнесения, отчёт ДДС.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(29);

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('ac000000-0000-0000-0000-0000000000ac', 'acc@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local');
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');
insert into public.clients (id, org_id, name, inn, status) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '5612345678', 'active');
update public.cash_accounts set opening_balance = 100000, opening_date = date_trunc('month', current_date)::date where org_id = private.default_org_id() and kind = 'bank';
create temp table bank as select id from public.cash_accounts where org_id = private.default_org_id() and kind = 'bank';
grant select on bank to authenticated;

-- Правило: всё со словом «аренда» — статья «Аренда офиса»
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select lives_ok($$insert into public.cashflow_rules (org_id, direction, match_words, category_id, note)
  select private.default_org_id(), 'out', array['аренда'], id, 'Аренда' from public.cashflow_categories where org_id = private.default_org_id() and code = 'rent'$$, 'Бухгалтер добавляет правило по словам');
select throws_ok($$insert into public.cashflow_rules (org_id, category_id) select private.default_org_id(), id from public.cashflow_categories where code = 'rent' and org_id = private.default_org_id()$$,
                 '23514', null, 'Правило без условия не принимается');

-- Оплата заказчика уже учтена сама
reset role;
insert into public.client_payments (id, org_id, client_id, payment_date, amount, source, doc_number, payer_name, payer_inn, purpose)
  values ('9a000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', current_date, 50000, 'bank_statement', '15', 'ООО Заказчик 1', '5612345678', 'Оплата по счёту');
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select count(*)::int from public.cashflow_entries where source = 'auto'), 1, 'Подготовка: оплата заказчика уже стала операцией');

-- Загрузка выписки: подтверждение оплаты, аренда по правилу, неизвестная операция, повтор
create temp table imp as select public.import_cashflow_statement(private.default_org_id(), (select id from bank), 'kl.txt', jsonb_build_array(
  jsonb_build_object('date', current_date, 'direction', 'in', 'amount', 50000, 'number', '15', 'counterparty_inn', '5612345678', 'counterparty_name', 'ООО Заказчик 1', 'purpose', 'Оплата по счёту'),
  jsonb_build_object('date', current_date, 'direction', 'out', 'amount', 20000, 'number', '31', 'counterparty_inn', '5600000001', 'counterparty_name', 'ИП Арендодатель', 'purpose', 'Аренда офиса за октябрь'),
  jsonb_build_object('date', current_date, 'direction', 'out', 'amount', 1500, 'number', '32', 'counterparty_inn', '5600000002', 'counterparty_name', 'ООО Канцелярия', 'purpose', 'Покупка канцтоваров'),
  jsonb_build_object('date', current_date, 'direction', 'out', 'amount', 700, 'number', '33', 'counterparty_inn', '5600000002', 'counterparty_name', 'ООО Канцелярия', 'purpose', 'Покупка бумаги')
)) as r;
grant select on imp to authenticated;
select is((select r->>'confirmed' from imp), '1', 'Оплата заказчика подтверждена выпиской, а не продублирована');
select is((select r->>'new' from imp), '3', 'Три строки стали новыми операциями');
select is((select r->>'sorted' from imp), '1', 'Одна разнесена по правилу');
select is((select r->>'queue' from imp), '2', 'Две ждут бухгалтера');
select is((select count(*)::int from public.cashflow_entries where source = 'auto'), 1, 'Дубля оплаты нет');
select is((select c.code from public.cashflow_entries e join public.cashflow_categories c on c.id = e.category_id where e.counterparty = 'ИП Арендодатель'), 'rent', 'Аренда попала в «Аренда офиса»');
select is((select r->>'duplicates' from (select public.import_cashflow_statement(private.default_org_id(), (select id from bank), 'kl.txt', jsonb_build_array(
  jsonb_build_object('date', current_date, 'direction', 'out', 'amount', 20000, 'number', '31', 'counterparty_inn', '5600000001', 'purpose', 'Аренда офиса за октябрь'))) as r) x), '1', 'Повторная загрузка той же строки — дубль');
select is((select count(*)::int from public.cashflow_entries where statement_key is not null), 4, 'У четырёх операций есть ключ строки выписки');

-- Очередь и новое правило из выбранной статьи
select is((select count(*)::int from public.cashflow_entries where category_id is null), 2, 'В очереди две операции');
select lives_ok($$select public.set_entry_category((select id from public.cashflow_entries where purpose = 'Покупка канцтоваров'), (select id from public.cashflow_categories where code = 'other_expense' and org_id = private.default_org_id()), true)$$, 'Бухгалтер разносит и запоминает правило');
select is((select count(*)::int from public.cashflow_entries where category_id is null), 0, 'Правило сразу разнесло вторую операцию того же контрагента');
select is((select match_inn from public.cashflow_rules where match_inn is not null), '5600000002', 'Правило создано по ИНН');
create temp table imp2 as select public.import_cashflow_statement(private.default_org_id(), (select id from bank), 'kl2.txt', jsonb_build_array(
  jsonb_build_object('date', current_date, 'direction', 'out', 'amount', 300, 'number', '40', 'counterparty_inn', '5600000002', 'purpose', 'Ручки'))) as r;
select is((select r->>'sorted' from imp2), '1', 'Следующая выписка с этим контрагентом разносится сама');

-- Выписка первой, оплата после: оплата не дублирует операцию
reset role;
insert into public.cashflow_entries (org_id, account_id, entry_date, direction, amount, category_id, counterparty, counterparty_inn, source, statement_key)
  values (private.default_org_id(), (select id from bank), current_date, 'in', 777, null, 'ООО Заказчик 1', '5612345678', 'statement', 'k-777');
insert into public.client_payments (org_id, client_id, payment_date, amount, source, doc_number, payer_inn, purpose)
  values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', current_date, 777, 'manual', '99', '5612345678', 'Оплата');
select is((select count(*)::int from public.cashflow_entries where amount = 777), 1, 'Оплата, внесённая после выписки, подтвердила уже созданную операцию');
select is((select source || '/' || basis_type from public.cashflow_entries where amount = 777), 'auto/client_payment', 'и получила основание — оплату заказчика');

-- ------------------------------------------------------------
-- Отчёт ДДС
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select amount_in from public.cashflow_report(array[private.default_org_id()], date_trunc('month', current_date)::date, current_date) where article = 'client_payment'), 50777.00, 'ДДС: поступления от заказчиков за месяц 50 777');
select is((select amount_out from public.cashflow_report(array[private.default_org_id()], date_trunc('month', current_date)::date, current_date) where article = 'rent'), 20000.00, 'ДДС: аренда 20 000');
select is((select amount_out from public.cashflow_report(array[private.default_org_id()], date_trunc('month', current_date)::date, current_date) where article = 'other_expense'), 2500.00, 'ДДС: прочие управленческие 2 500 (1 500 + 700 + 300)');
select is((select count(*)::int from public.cashflow_report(array[private.default_org_id()], date_trunc('month', current_date)::date, current_date) where article = 'unsorted'), 0, 'Неразнесённых нет');
select is(public.cash_total_balance(array[private.default_org_id()], current_date), (100000 + 50777 - 20000 - 2500)::numeric, 'Остаток: 100 000 + 50 777 − 20 000 − 2 500');
select is(public.cash_total_balance(array[private.default_org_id()], current_date - 40), 100000::numeric, 'Остаток на дату до начала учёта равен входящему остатку');

-- Перемещения в отчёт не входят
select public.transfer_cash(private.default_org_id(), (select id from bank), (select id from public.cash_accounts where kind = 'platform' and org_id = private.default_org_id()), current_date, 9000);
select is((select sum(amount_out) from public.cashflow_report(array[private.default_org_id()], date_trunc('month', current_date)::date, current_date)), 22500.00, 'Перемещение на платформу в расходах ДДС не учитывается');
select is((select balance from public.cash_balances(private.default_org_id(), current_date) where kind = 'platform'), 9000.00, 'но платформа получила 9 000');

-- Доступ
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select * from public.cashflow_report(array[private.default_org_id()], current_date - 30, current_date)$$, '42501', null, 'Продавцу отчёт ДДС недоступен');
select throws_ok($$select public.import_cashflow_statement(private.default_org_id(), (select id from bank), 'x', '[]'::jsonb)$$, '42501', null, 'и загрузка выписки тоже');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select ok((select count(*) from public.cashflow_report(array[private.default_org_id()], current_date - 30, current_date)) > 0, 'Руководитель видит отчёт');

select * from finish();
rollback;
