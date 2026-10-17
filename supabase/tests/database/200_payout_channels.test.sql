-- Шаг 19: каналы выплат, сверка, кабинет исполнителя.
-- Приёмка из ТЗ (раздел 15): одна строка с ошибкой возвращается в «к выплате», остальные отмечены проведёнными и имеют чеки.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(33);
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
update public.organizations set name = 'ООО Работа для Всех', inn = '5612345678' where id = private.default_org_id();
insert into public.clients (id, org_id, name, sales_manager_id, sites_manager_id, status) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active');
insert into public.sites (id, name, client_id, site_manager_id, status, latitude, longitude, checkin_method) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.7682, 55.097, 'geo');
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 400, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
-- W1 — самозанятый (платформа), W2 — ИП и W3 — ГПХ (банк), W4 — самозанятый для проверки ошибки
update public.workers set tax_status = case user_id when pg_temp.w(1) then 'self_employed' when pg_temp.w(4) then 'self_employed' when pg_temp.w(3) then 'gph' else 'ip' end,
       full_name = 'Исполнитель ' || right(user_id::text, 38)::text where user_id in (select pg_temp.w(i) from generate_series(1, 4) i);
update public.workers set full_name = 'Иванов Иван' where user_id = pg_temp.w(2);
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from generate_series(1, 4) i, public.positions p
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';

set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select 'a1000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
         current_date + 2, current_date + 2, '08:00', '19:00', 4, 0, 60
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order('a1000000-0000-0000-0000-000000000001');
select public.assign_workers((select array_agg(id) from public.shifts), array[pg_temp.w(1), pg_temp.w(2), pg_temp.w(3), pg_temp.w(4)]);
reset role;
update public.assignments set status = 'worked', planned_hours = 10, approved_hours = 10;
update public.assignments set approved_hours = 8.33 where worker_id = pg_temp.w(3);
select private.create_accrual_for_assignment(id) from public.assignments;
update public.accruals set shift_date = current_date - 5;
update public.workers set npd_status = 'active', npd_checked_at = now() where user_id in (pg_temp.w(1), pg_temp.w(4));

set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select public.submit_payout_requisites(pg_temp.w(1), 'platform', '+79000000001');
select public.submit_payout_requisites(pg_temp.w(2), 'bank_account', '40817810000000000002, БИК 044525225');
select public.submit_payout_requisites(pg_temp.w(3), 'bank_card', '4276000000000003');
select public.submit_payout_requisites(pg_temp.w(4), 'platform', '+79000000004');
create temp table built as select public.build_payout_registries(private.default_org_id(), current_date - 30, current_date) as r;
grant select on built to authenticated;
select is((select jsonb_array_length(r->'registries') from built), 2, 'Подготовка: два реестра — банк и платформа');

-- ------------------------------------------------------------
-- Файл платежей банка
-- ------------------------------------------------------------
select throws_ok($$select * from public.payout_registry_export((select id from public.payout_registries where channel = 'bank'))$$, '22023', null, 'Неподтверждённый реестр выгружать нельзя');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select public.confirm_payout_registry(id) from public.payout_registries;
select is((select count(*)::int from public.payout_registries where status = 'confirmed'), 2, 'Руководитель подтвердил оба реестра');
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select count(*)::int from public.payout_registry_export((select id from public.payout_registries where channel = 'bank'))), 2, 'В выгрузке банка две строки');
select is((select account || '/' || bik from public.payout_registry_export((select id from public.payout_registries where channel = 'bank')) where worker_name = 'Иванов Иван'), '40817810000000000002/044525225', 'Счёт и БИК выделены из реквизитов');
select is((select account is null from public.payout_registry_export((select id from public.payout_registries where channel = 'bank')) where worker_name <> 'Иванов Иван'), true, 'Для карты номера счёта нет');
select ok((select purpose like '%реестр РВ-%' from public.payout_registry_export((select id from public.payout_registries where channel = 'bank')) limit 1), 'В назначении платежа номер реестра');
reset role;
select ok(exists (select 1 from public.audit_log where table_name = 'payout_registries' and field = 'requisites'), 'Выгрузка реквизитов записана в журнал');
set local role authenticated;
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select * from public.payout_registry_export((select id from public.payout_registries where channel = 'bank'))$$, '42501', null, 'Продавец реквизиты реестра не выгружает');
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select lives_ok($$select public.mark_registry_sent((select id from public.payout_registries where channel = 'bank'))$$, 'Реестр банка отмечен отправленным');
select throws_ok($$select public.mark_registry_sent((select id from public.payout_registries where channel = 'bank'))$$, '22023', null, 'Второй раз отправить нельзя');

-- ------------------------------------------------------------
-- Сверка по выписке банка
-- ------------------------------------------------------------
create temp table rec as select public.reconcile_bank_statement(private.default_org_id(), jsonb_build_array(
  jsonb_build_object('amount', (select amount_worker from public.accruals where worker_id = pg_temp.w(3)), 'number', '77', 'recipient_name', 'Кто-то', 'purpose', 'Оплата услуг по договору, реестр ' || (select number from public.payout_registries where channel = 'bank') || ', без НДС'),
  jsonb_build_object('amount', 3000, 'number', '78', 'recipient_name', 'Иванов Иван', 'purpose', 'Оплата'),
  jsonb_build_object('amount', 12345, 'number', '79', 'recipient_name', 'Неизвестный', 'purpose', 'Прочее')
)) as r;
select is((select r->>'matched' from rec), '2', 'Два исходящих платежа нашли свои строки: по номеру реестра и по ФИО');
select is(jsonb_array_length((select r->'unmatched' from rec)), 1, 'Третий остался без пары');
select is((select status from public.payout_registries where channel = 'bank'), 'paid', 'Реестр банка проведён');
select is((select status from public.accruals where worker_id = pg_temp.w(2)), 'paid', 'Начисления ИП — «выплачено»');
select is((select provider_payment_id from public.payout_lines where worker_id = pg_temp.w(2)), 'п/п 78', 'Номер платёжки сохранён');
reset role;
select ok(exists (select 1 from public.notifications where event = 'payout_paid' and user_id = pg_temp.w(2)), 'Исполнитель уведомлён о выплате');
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';

-- ------------------------------------------------------------
-- Платформа: служебный интерфейс и ручной режим
-- ------------------------------------------------------------
select ok((select public.platform_send_allowed((select id from public.payout_registries where channel = 'platform'))), 'Бухгалтер может отправить реестр платформы');
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select is((select public.platform_send_allowed((select id from public.payout_registries where channel = 'platform'))), false, 'Продавец не может');
set local role authenticated;
select throws_ok($$select * from public.platform_registry_payload((select id from public.payout_registries where channel = 'platform'))$$, '42501', null, 'Данные для платформы выдаются только служебной ролью');
reset role;
set local role service_role;
select is((select count(*)::int from public.platform_registry_payload((select id from public.payout_registries where channel = 'platform'))), 2, 'Платформа получает двух самозанятых');
select is((select requisites from public.platform_registry_payload((select id from public.payout_registries where channel = 'platform')) where worker_id = pg_temp.w(1)), '+79000000001', 'с расшифрованными реквизитами');
select lives_ok($$select public.platform_record_result((select id from public.payout_lines where worker_id = pg_temp.w(1)), 'paid', 'plat-1', 'https://lknpd.nalog.ru/receipt/abc')$$, 'Ответ платформы: проведено, чек получен');
select lives_ok($$select public.platform_record_result((select id from public.payout_lines where worker_id = pg_temp.w(4)), 'error', NULL, NULL, 'Исполнитель не привязал платформу в «Мой налог»')$$, 'Ответ платформы: ошибка');
reset role;
select is((select status from public.payout_registries where channel = 'platform'), 'errors', 'Реестр платформы: одна проведена, одна с ошибкой — «ошибки»');
select is((select status from public.accruals where worker_id = pg_temp.w(4)), 'approved', 'Сумма ошибочной строки вернулась в «к выплате»');
select ok(exists (select 1 from public.notifications where event = 'payout_failed' and user_id = pg_temp.w(4)), 'Исполнитель получил уведомление об ошибке');
select ok(exists (select 1 from public.notifications where event = 'payout_failed' and user_id = 'ac000000-0000-0000-0000-0000000000ac'), 'Бухгалтер тоже');
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select string_agg(status || ':' || lines, ',' order by status) from public.payout_registry_report((select id from public.payout_registries where channel = 'platform'))), 'error:1,paid:1', 'Отчёт сверки: одна проведена, одна ошибка');
select throws_ok($$select public.settle_payout_lines((select id from public.payout_registries where channel = 'platform'), array[(select id from public.payout_lines where worker_id = pg_temp.w(4))], 'error', '')$$, '22023', null, 'Ручная ошибка без текста невозможна');

-- ------------------------------------------------------------
-- Кабинет исполнителя
-- ------------------------------------------------------------
set local request.jwt.claim.sub = '77000001-0000-0000-0000-000000000000';
select is((select status || '/' || receipt from public.worker_payouts(current_date - 30, current_date + 30)), 'paid/https://lknpd.nalog.ru/receipt/abc', 'Исполнитель видит свою выплату и чек');
select is((select sum(accrued) || '/' || sum(paid) from public.worker_income_certificate(current_date - 40, current_date)), '3000.00/3000.00', 'Справка о заработке: начислено 3 000, выплачено 3 000');
set local request.jwt.claim.sub = '77000002-0000-0000-0000-000000000000';
select is((select count(*)::int from public.worker_payouts(current_date - 30, current_date + 30) where receipt like '%abc'), 0, 'Чужие выплаты не видны');

select * from finish();
rollback;
