-- Шаг 14: акты, УПД и счета заказчикам.
-- Приёмка из ТЗ (раздел 14): за неделю по заказчику с двумя объектами формируется один акт,
-- сумма равна сумме подтверждённых начислений до копейки.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(45);

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

insert into public.clients (id, org_id, name, sales_manager_id, sites_manager_id, status) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active');
insert into public.client_contacts (org_id, client_id, full_name, user_id, cabinet_role)
  values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Кабинет 1', 'c0000000-0000-0000-0000-00000000000c', 'client_admin');
insert into public.contracts (id, org_id, client_id, number, signed_on, billing_period, payment_delay_days, status, allows_simple_esign)
  values ('c0170000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Д-1', current_date - 400, 'week', 10, 'active', true);
insert into public.sites (id, name, client_id, site_manager_id, status, latitude, longitude, checkin_method) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.7682, 55.097, 'geo'),
  ('51e00000-0000-0000-0000-000000000002', 'Склад 2', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.7682, 55.097, 'geo');
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 400, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
update public.workers set tax_status = 'self_employed' where user_id in (select pg_temp.w(i) from generate_series(1, 3) i);
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from generate_series(1, 3) i, public.positions p
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';

-- Два объекта: на первом двое, на втором один; по десять часов каждый
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select o.id, private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', o.site, p.id,
         current_date + 2, current_date + 2, '08:00', '19:00', o.n, 0, 60
  from public.positions p
  join (values ('a1000000-0000-0000-0000-000000000001'::uuid, '51e00000-0000-0000-0000-000000000001'::uuid, 2),
               ('a2000000-0000-0000-0000-000000000002'::uuid, '51e00000-0000-0000-0000-000000000002'::uuid, 1)) o(id, site, n) on true
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order('a1000000-0000-0000-0000-000000000001');
select public.accept_order('a2000000-0000-0000-0000-000000000002');
select public.assign_workers((select array_agg(id) from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001'), array[pg_temp.w(1), pg_temp.w(2)]);
select public.assign_workers((select array_agg(id) from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), array[pg_temp.w(3)]);

reset role;
update public.assignments set status = 'worked', planned_hours = 10, approved_hours = 10;
select private.create_accrual_for_assignment(id) from public.assignments;
-- Смены «прошли»: начисления относятся к прошлой неделе
update public.accruals set shift_date = current_date - 20;
select is((select count(*)::int from public.accruals where kind = 'main'), 3, 'Подготовка: три основных начисления на 4500');

-- ------------------------------------------------------------
-- Черновик
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select public.generate_client_documents('c1000000-0000-0000-0000-000000000001', current_date - 30, current_date - 10)$$,
                 '42501', null, 'Продавец документы не формирует');
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
create temp table act as select public.generate_client_documents('c1000000-0000-0000-0000-000000000001', current_date - 30, current_date - 10) as id;
grant select on act to authenticated;
select is((select kind from public.client_documents where id = (select id from act)), 'act', 'Бухгалтер получил черновик акта');
select is((select count(*)::int from public.client_documents where parent_document_id = (select id from act) and kind = 'invoice'), 1, 'и черновик счёта к нему');
select is((select count(*)::int from public.client_document_lines where document_id = (select id from act)), 2, 'Строки сгруппированы по объектам: две');
select is((select amount from public.client_document_lines where document_id = (select id from act) and site_name = 'Склад 1'), 9000.00, 'Склад 1: два человека по 4500');
select is((select amount_total from public.client_documents where id = (select id from act)), 13500.00, 'Сумма акта равна сумме начислений: 13 500');
select is((select amount_total from public.client_documents where parent_document_id = (select id from act)), 13500.00, 'Сумма счёта та же');
select is((select count(*)::int from public.accruals where client_document_id = (select id from act)), 3, 'Все три начисления привязаны к акту');
select throws_ok($$select public.generate_client_documents('c1000000-0000-0000-0000-000000000001', current_date - 9, current_date - 1)$$,
                 '22023', null, 'Начисления из другого черновика второй раз не берутся');

set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select is((select count(*)::int from public.client_documents), 0, 'Менеджер объекта документов не видит');
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select is((select count(*)::int from public.client_documents), 0, 'Заказчик черновиков не видит');
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.client_documents), 2, 'Продавец видит документы своего заказчика');

-- НДС из карточки организации
reset role;
update public.organizations set vat_rate = 20 where id = private.default_org_id();
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select public.generate_client_documents('c1000000-0000-0000-0000-000000000001', current_date - 30, current_date - 10);
select is((select vat_amount || '/' || amount_total from public.client_documents where kind = 'act' and status = 'draft'), '2700.00/16200.00', 'НДС 20% сверху: 2 700, итого 16 200');
reset role;
update public.organizations set vat_rate = 0 where id = private.default_org_id();
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
create temp table act2 as select public.generate_client_documents('c1000000-0000-0000-0000-000000000001', current_date - 30, current_date - 10) as id;
select is((select count(*)::int from public.client_documents where kind = 'act' and status = 'draft'), 1, 'Повторная сборка заменила черновик, а не добавила второй');

-- ------------------------------------------------------------
-- Выставление и неизменность
-- ------------------------------------------------------------
select lives_ok($$select public.issue_client_documents((select id from act2))$$, 'Бухгалтер выставляет акт и счёт');
select is((select number from public.client_documents where kind = 'act' and status = 'issued'), 'АКТ-' || extract(year from current_date)::int || '/1', 'Номер акта — первый в году');
select is((select number from public.client_documents where kind = 'invoice' and status = 'issued'), 'СЧ-' || extract(year from current_date)::int || '/1', 'Счёт нумеруется отдельно');
select is((select due_date from public.client_documents where kind = 'invoice' and status = 'issued'), current_date + 10, 'Срок оплаты — по договору, 10 дней');
select is((select count(*)::int from public.accruals where status = 'in_act'), 3, 'Начисления перешли в «В акте»');
reset role;
select throws_ok($$update public.client_documents set amount_total = 1 where kind = 'act'$$, '22023', null, 'Сумму выставленного документа не поменять');
select throws_ok($$delete from public.client_documents where kind = 'act'$$, '22023', null, 'Выставленный документ не удалить');
select throws_ok($$update public.client_document_lines set amount = 1$$, '22023', null, 'Строки выставленного документа не правятся');

-- Аннулирование
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select throws_ok($$select public.cancel_client_documents((select id from act2), '')$$, '22023', null, 'Аннулирование без причины невозможно');
select lives_ok($$select public.cancel_client_documents((select id from act2), 'Ошибка в периоде')$$, 'Выставленный документ аннулируется с причиной');
select is((select count(*)::int from public.client_documents where status = 'cancelled'), 2, 'Аннулированы акт и счёт');
select is((select count(*)::int from public.accruals where status = 'approved' and client_document_id is null), 3, 'Начисления вернулись и ждут нового документа');

-- Заново: номера идут дальше, у аннулированного номер остаётся
create temp table act3 as select public.generate_client_documents('c1000000-0000-0000-0000-000000000001', current_date - 30, current_date - 10) as id;
select public.issue_client_documents((select id from act3));
select is((select string_agg(number_seq::text, ',' order by number_seq) from public.client_documents where kind = 'act' and status in ('issued', 'cancelled')), '1,2', 'Номера актов 1 и 2 без пропусков');

-- Отправка, кабинет и подпись
select lives_ok($$select public.send_client_document((select id from act3))$$, 'Документы отправлены заказчику');
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select is((select count(*)::int from public.client_documents), 2, 'Заказчик видит акт и счёт, но не аннулированные и не черновики');
select is((select count(*)::int from public.client_document_lines), 4, 'и их строки');
select lives_ok($$select public.accept_client_document((select id from public.client_documents where kind = 'act' and status = 'issued'))$$, 'Заказчик нажимает «Принято»');
select is((select string_agg(status, ',') from public.client_documents where status = 'signed'), 'signed,signed', 'Акт и счёт подписаны');
reset role;
select ok(exists (select 1 from public.notifications where event = 'document_issued' and user_id = 'c0000000-0000-0000-0000-00000000000c'), 'Заказчику ушло уведомление');
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select throws_ok($$select public.cancel_client_documents((select id from act3), 'Передумали')$$, '22023', null, 'Подписанный документ не аннулируется');

-- Корректировка после выставления идёт в следующий документ отдельной строкой
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select public.add_correction((select id from public.accruals where kind = 'main' limit 1), -150, -100,
  (select id from public.directories where kind = 'deduction_reason' limit 1), 'Пересчёт по акту сверки');
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
create temp table act4 as select public.generate_client_documents('c1000000-0000-0000-0000-000000000001', current_date - 9, current_date - 1) as id;
select is((select line_kind || '/' || amount from public.client_document_lines where document_id = (select id from act4)), 'correction/-150.00', 'Корректировка — отдельная строка на -150');
select ok((select note from public.client_document_lines where document_id = (select id from act4)) like 'Корректировка за %', 'со ссылкой на исходный период');

-- Подпись сканом, когда договор не допускает кнопку
reset role;
update public.contracts set allows_simple_esign = false;
update public.client_documents set status = 'issued', signed_at = null, sign_method = null where id in (select id from act3 union select id from public.client_documents where parent_document_id = (select id from act3));
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select throws_ok($$select public.accept_client_document((select id from act3))$$, '22023', null, 'Если договор не допускает, кнопкой не подписать');
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select lives_ok($$select public.register_document_signature((select id from act3), 'docs/scan.pdf')$$, 'Бухгалтер регистрирует подписанный скан');

-- ------------------------------------------------------------
-- Периоды выставления и автоматические черновики
-- ------------------------------------------------------------
reset role;
select is((select period_from || '/' || period_to from private.billing_period_bounds('month', date '2026-01-01', date '2026-03-15')), '2026-02-01/2026-02-28', 'Месяц: прошлый календарный');
select is((select period_from || '/' || period_to from private.billing_period_bounds('week', date '2026-01-01', date '2026-03-11')), '2026-03-02/2026-03-08', 'Неделя: прошлая с понедельника по воскресенье');
select is((select period_from || '/' || period_to from private.billing_period_bounds('two_weeks', date '2026-01-07', date '2026-02-10')), '2026-01-19/2026-02-01', 'Две недели: блоки по 14 дней от недели подписания');

-- Доначисление на прошлой неделе: сам создаётся черновик и приходит бухгалтеру
update public.accruals set shift_date = date_trunc('week', current_date)::date - 3 where kind = 'correction';
delete from public.client_documents where id in (select id from act4) or parent_document_id = (select id from act4);
update public.accruals set client_document_id = null where kind = 'correction';
select is(private.generate_due_documents(), 1, 'Раз в сутки сама создаётся черновик за прошлый период');
select ok(exists (select 1 from public.notifications where event = 'document_draft_ready' and user_id = 'ac000000-0000-0000-0000-0000000000ac'), 'Бухгалтеру пришло уведомление о черновике');
select is(private.generate_due_documents(), 0, 'Повторный запуск второй черновик не создаёт');

select * from finish();
rollback;
