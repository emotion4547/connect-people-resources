-- Шаг 15: оплаты, дебиторка, кредитный лимит, акт сверки.
-- Приёмка из ТЗ (раздел 14): выписка с платежами разносится автоматически, долг и просрочка пересчитываются сразу.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(41);

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('ac000000-0000-0000-0000-0000000000ac', 'acc@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'cu@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 3) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'site_manager' where user_id = '5c000000-0000-0000-0000-0000000000c1';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
update public.user_roles set role = 'client_admin' where user_id = 'c0000000-0000-0000-0000-00000000000c';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');
update public.organizations set bank_account = '40702810000000000001' where id = private.default_org_id();

insert into public.clients (id, org_id, name, inn, sales_manager_id, sites_manager_id, status) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '5612345678', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active'),
  ('c2000000-0000-0000-0000-000000000002', private.default_org_id(), 'Заказчик 2', '5698765432', NULL, NULL, 'active');
insert into public.client_contacts (org_id, client_id, full_name, user_id, cabinet_role)
  values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Кабинет 1', 'c0000000-0000-0000-0000-00000000000c', 'client_admin');
insert into public.contracts (id, org_id, client_id, number, signed_on, billing_period, payment_delay_days, status)
  values ('c0170000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Д-1', current_date - 400, 'week', 10, 'active');
insert into public.sites (id, name, client_id, site_manager_id, status, latitude, longitude, checkin_method) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.7682, 55.097, 'geo');
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 400, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
update public.workers set tax_status = 'self_employed' where user_id in (select pg_temp.w(i) from generate_series(1, 3) i);
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from generate_series(1, 3) i, public.positions p
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';

-- Три смены по 10 часов → начисления на 13 500 → выставленные акт и счёт
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select 'a1000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
         current_date + 2, current_date + 2, '08:00', '19:00', 3, 0, 60
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order('a1000000-0000-0000-0000-000000000001');
select public.assign_workers((select array_agg(id) from public.shifts), array[pg_temp.w(1), pg_temp.w(2), pg_temp.w(3)]);
reset role;
update public.assignments set status = 'worked', planned_hours = 10, approved_hours = 10;
select private.create_accrual_for_assignment(id) from public.assignments;
update public.accruals set shift_date = current_date - 20;

set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
create temp table act as select public.generate_client_documents('c1000000-0000-0000-0000-000000000001', current_date - 30, current_date - 10) as id;
select public.issue_client_documents((select id from act));
create temp table inv as select id from public.client_documents where kind = 'invoice';
grant select on act, inv to authenticated;
select is((select status || '/' || amount_total from public.client_documents where id = (select id from inv)), 'issued/13500.00', 'Подготовка: выставлен счёт на 13 500');

-- ------------------------------------------------------------
-- Загрузка выписки: платёж по номеру счёта, платёж по сумме, платёж неизвестного плательщика
-- ------------------------------------------------------------
select throws_ok($$select public.import_bank_statement(private.default_org_id(), 'kl.txt', '40702810999999999999', '[]'::jsonb)$$,
                 '22023', null, 'Выписка по чужому счёту не принимается');
create temp table imp as select public.import_bank_statement(private.default_org_id(), 'kl_to_1c.txt', '40702810000000000001', jsonb_build_array(
  jsonb_build_object('date', current_date, 'amount', 5000, 'number', '101', 'payer_inn', '5612345678', 'payer_name', 'Заказчик 1',
    'purpose', 'Оплата по счёту СЧ-' || extract(year from current_date)::int || '/1 за услуги'),
  jsonb_build_object('date', current_date, 'amount', 8500, 'number', '102', 'payer_inn', '5612345678', 'payer_name', 'Заказчик 1', 'purpose', 'Оплата услуг персонала'),
  jsonb_build_object('date', current_date, 'amount', 777, 'number', '103', 'payer_inn', '7700000000', 'payer_name', 'Неизвестный', 'purpose', 'Прочее')
)) as r;
grant select on imp to authenticated;
select is((select r->>'new' from imp), '3', 'Загружено три платежа');
select is((select r->>'allocated' from imp), '2', 'Два разнесены сами');
select is((select r->>'queue' from imp), '1', 'Один ушёл в очередь бухгалтера');
select is((select status from public.client_documents where id = (select id from inv)), 'paid', 'Счёт оплачен: 5 000 по номеру и 8 500 по точной сумме');
select is((select allocated_amount from public.client_payments where doc_number = '101'), 5000.00, 'Платёж по номеру счёта разнесён');
select is((select client_id from public.client_payments where doc_number = '102'), 'c1000000-0000-0000-0000-000000000001'::uuid, 'Заказчик определён по ИНН');
select is((select count(*)::int from public.client_payments where client_id is null), 1, 'Неизвестный плательщик — без заказчика');

-- Повторная загрузка той же выписки ничего не дублирует
select is((select public.import_bank_statement(private.default_org_id(), 'kl_to_1c.txt', '40702810000000000001', jsonb_build_array(
  jsonb_build_object('date', current_date, 'amount', 5000, 'number', '101', 'payer_inn', '5612345678', 'purpose', 'x')))->>'duplicates'), '1', 'Повторная загрузка: платёж распознан как дубль');

-- Долг пересчитался сразу
select is((select invoiced || '/' || paid || '/' || debt from public.client_receivables() where client_id = 'c1000000-0000-0000-0000-000000000001'), '13500.00/13500.00/0.00', 'Дебиторка: выставлено 13 500, оплачено 13 500, долг 0');

-- ------------------------------------------------------------
-- Очередь и ручное разнесение
-- ------------------------------------------------------------
reset role;
-- Дополнительные счета с разной просрочкой
insert into public.client_documents (org_id, kind, client_id, contract_id, number, number_seq, issue_date, period_from, period_to, due_date, status, amount_net, amount_total) values
  (private.default_org_id(), 'invoice', 'c1000000-0000-0000-0000-000000000001', 'c0170000-0000-0000-0000-000000000001', 'СЧ-X/90', 90, current_date - 60, current_date - 70, current_date - 61, current_date - 100, 'issued', 50, 50),
  (private.default_org_id(), 'invoice', 'c1000000-0000-0000-0000-000000000001', 'c0170000-0000-0000-0000-000000000001', 'СЧ-X/91', 91, current_date - 50, current_date - 60, current_date - 51, current_date - 45, 'issued', 1000, 1000),
  (private.default_org_id(), 'invoice', 'c1000000-0000-0000-0000-000000000001', 'c0170000-0000-0000-0000-000000000001', 'СЧ-X/92', 92, current_date - 20, current_date - 30, current_date - 21, current_date - 10, 'issued', 200, 200),
  (private.default_org_id(), 'invoice', 'c1000000-0000-0000-0000-000000000001', 'c0170000-0000-0000-0000-000000000001', 'СЧ-X/93', 93, current_date, current_date - 10, current_date - 1, current_date + 10, 'issued', 300, 300);
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select overdue_30 || '/' || overdue_60 || '/' || overdue_60p || '/' || not_due || '/' || debt
           from public.client_receivables() where client_id = 'c1000000-0000-0000-0000-000000000001'), '200.00/1000.00/50.00/300.00/1550.00',
          'Просрочка: 200 до 30 дней, 1 000 до 60, 50 больше 60, не просрочено 300');
select is((select max_overdue_days from public.client_receivables() where client_id = 'c1000000-0000-0000-0000-000000000001'), 100, 'Самая старая просрочка — 100 дней');

-- Платёж из очереди: назначаем заказчика и разносим на счёт вручную
select lives_ok($$select public.assign_payment_client((select id from public.client_payments where doc_number = '103'), 'c1000000-0000-0000-0000-000000000001')$$, 'Бухгалтер назначает заказчика платежу из очереди');
select lives_ok($$select public.allocate_payment((select id from public.client_payments where doc_number = '103'), (select id from public.client_documents where number = 'СЧ-X/91'), 700)$$, 'и разносит 700 на счёт');
select is((select status from public.client_documents where number = 'СЧ-X/91'), 'paid_partial', 'Счёт оплачен частично');
select throws_ok($$select public.allocate_payment((select id from public.client_payments where doc_number = '103'), (select id from public.client_documents where number = 'СЧ-X/91'), 700)$$,
                 '22023', null, 'Больше остатка платежа не разнести (остаток 77)');
select throws_ok($$select public.allocate_payment((select id from public.client_payments where doc_number = '103'), (select id from public.client_documents where number = 'СЧ-X/92'), 100)$$,
                 '22023', null, 'и больше остатка платежа на втором счёте тоже');
select lives_ok($$select public.unallocate_payment((select id from public.payment_allocations limit 1 offset 0))$$, 'Разнесение можно снять');
select ok((select count(*) from public.payment_allocations) >= 2, 'после снятия остальные разнесения на месте');

-- Ручной ввод оплаты
select lives_ok($$select public.add_client_payment(private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', current_date, 200, '555', 'Оплата счёта 92')$$, 'Оплата вводится вручную');
select is((select status from public.client_documents where number = 'СЧ-X/92'), 'paid', 'и сама разносится по сумме и номеру счёта');

-- Аннулирование оплаченного невозможно
select throws_ok($$select public.cancel_client_documents((select id from act), 'Передумали')$$, '22023', null, 'Документы с оплатой не аннулируются');

-- ------------------------------------------------------------
-- Доступ
-- ------------------------------------------------------------
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select ok((select count(*) from public.client_payments) >= 1, 'Продавец видит платежи своего заказчика');
select is((select count(*)::int from public.client_payments where client_id is null), 0, 'но очередь без заказчика не видит');
select throws_ok($$select public.add_client_payment(private.default_org_id(), null, current_date, 10, '1', 'x')$$, '42501', null, 'и платежи не вводит');
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select is((select count(*)::int from public.client_payments), 0, 'Менеджер объекта платежей не видит');
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select is((select count(*)::int from public.client_payments), 0, 'Заказчик платежей в таблице не видит');

-- ------------------------------------------------------------
-- Просрочка и уведомления
-- ------------------------------------------------------------
reset role;
select ok(private.notify_overdue_invoices() >= 2, 'Раз в сутки: уведомления о просрочке менеджеру продаж и бухгалтеру');
select ok(exists (select 1 from public.notifications where event = 'invoice_overdue' and user_id = '51000000-0000-0000-0000-000000000001'), 'Менеджер продаж уведомлён');
select is(private.notify_overdue_invoices(), 0, 'Повторно в ту же неделю — нет');

-- ------------------------------------------------------------
-- Кредитный лимит
-- ------------------------------------------------------------
update public.clients set credit_limit = 500 where id = 'c1000000-0000-0000-0000-000000000001';
select ok(private.client_credit_blocked('c1000000-0000-0000-0000-000000000001') like 'долг % больше кредитного лимита%', 'Долг больше лимита — заказчик на контроле');
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, break_minutes)
  select 'a2000000-0000-0000-0000-000000000002', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
         current_date + 5, current_date + 5, '08:00', '17:00', 1, 60
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select throws_ok($$select public.accept_order('a2000000-0000-0000-0000-000000000002')$$, '42501', null, 'Менеджер объекта такой заказ принять не может');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select lives_ok($$select public.accept_order('a2000000-0000-0000-0000-000000000002')$$, 'Руководитель принимает');
reset role;
update public.clients set credit_limit = NULL, max_overdue_days = 20 where id = 'c1000000-0000-0000-0000-000000000001';
select ok(private.client_credit_blocked('c1000000-0000-0000-0000-000000000001') like 'просрочка % дн.%', 'Просрочка дольше срока — тоже контроль');
update public.clients set max_overdue_days = 500 where id = 'c1000000-0000-0000-0000-000000000001';
select is(private.client_credit_blocked('c1000000-0000-0000-0000-000000000001'), NULL, 'В пределах допустимого — без ограничений');

-- ------------------------------------------------------------
-- Акт сверки
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select row_kind || '/' || balance from public.client_reconciliation('c1000000-0000-0000-0000-000000000001', current_date - 200, current_date) where row_kind = 'opening'), 'opening/0', 'Акт сверки: сальдо на начало 0');
select is((select count(*)::int from public.client_reconciliation('c1000000-0000-0000-0000-000000000001', current_date, current_date) where row_kind = 'invoice'), 2, 'Счета за день попали в сверку');
select is((select balance from public.client_reconciliation('c1000000-0000-0000-0000-000000000001', current_date - 200, current_date) where row_kind = 'closing'),
          (select debt - unallocated from public.client_receivables() where client_id = 'c1000000-0000-0000-0000-000000000001'), 'Сальдо сверки на конец равно долгу за вычетом неразнесённых платежей');
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select ok((select count(*) from public.client_reconciliation('c1000000-0000-0000-0000-000000000001', current_date - 200, current_date)) >= 2, 'Заказчик видит акт сверки по себе');
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select throws_ok($$select * from public.client_reconciliation('c1000000-0000-0000-0000-000000000001', current_date - 200, current_date)$$, '42501', null, 'Менеджер объекта сверку не получает');

select * from finish();
rollback;
