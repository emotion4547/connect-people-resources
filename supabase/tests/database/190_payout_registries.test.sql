-- Шаг 18: реестры выплат и авансы.
-- Приёмка из ТЗ (раздел 15): реестр сам делится на платформу и банк; исполнитель без реквизитов и снятый с учёта самозанятый
-- не попадают в него; аванс удерживается.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(42);
set local app.pii_key = 'test-key-0123456789abcdef0123456789abcdef';

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('ac000000-0000-0000-0000-0000000000ac', 'acc@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('ec000000-0000-0000-0000-0000000000ec', 'rec@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 5) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'site_manager' where user_id = '5c000000-0000-0000-0000-0000000000c1';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
update public.user_roles set role = 'recruiter' where user_id = 'ec000000-0000-0000-0000-0000000000ec';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales'),
  ('ec000000-0000-0000-0000-0000000000ec', 'Рекрутер', 'hiring');

insert into public.clients (id, org_id, name, sales_manager_id, sites_manager_id, status) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active');
insert into public.sites (id, name, client_id, site_manager_id, status, latitude, longitude, checkin_method) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.7682, 55.097, 'geo');
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 400, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
-- W1 — самозанятый, W2 — ИП, W3 — ГПХ, W4 — ИП без реквизитов, W5 — самозанятый, снятый с учёта
update public.workers set tax_status = case user_id when pg_temp.w(1) then 'self_employed' when pg_temp.w(5) then 'self_employed'
  when pg_temp.w(3) then 'gph' else 'ip' end where user_id in (select pg_temp.w(i) from generate_series(1, 5) i);
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from generate_series(1, 5) i, public.positions p
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';

-- Пять человек отработали по 10 часов → по 3 000 ₽ каждому
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select 'a1000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
         current_date + 2, current_date + 2, '08:00', '19:00', 5, 0, 60
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order('a1000000-0000-0000-0000-000000000001');
select public.assign_workers((select array_agg(id) from public.shifts), array[pg_temp.w(1), pg_temp.w(2), pg_temp.w(3), pg_temp.w(4), pg_temp.w(5)]);
reset role;
update public.assignments set status = 'worked', planned_hours = 10, approved_hours = 10;
select private.create_accrual_for_assignment(id) from public.assignments;
update public.accruals set shift_date = current_date - 5;

-- Реквизиты и статусы
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select public.submit_payout_requisites(pg_temp.w(1), 'platform', '+79000000001');
select public.submit_payout_requisites(pg_temp.w(2), 'bank_account', '40817810000000000002');
select public.submit_payout_requisites(pg_temp.w(3), 'bank_card', '4276000000000003');
select public.submit_payout_requisites(pg_temp.w(5), 'platform', '+79000000005');
reset role;
update public.workers set npd_status = 'active', npd_checked_at = now() where user_id = pg_temp.w(1);
update public.workers set npd_status = 'inactive', npd_checked_at = now() where user_id = pg_temp.w(5);

-- ------------------------------------------------------------
-- Аванс
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '77000002-0000-0000-0000-000000000000';
select is((select room from public.advance_limit(pg_temp.w(2))), 1500.00, 'Лимит аванса: половина начисленного, 1 500 из 3 000');
select throws_ok($$select public.request_advance(2000)$$, '22023', null, 'Больше лимита запросить нельзя');
select lives_ok($$select public.request_advance(1000, 'К зарплате')$$, 'Исполнитель запрашивает аванс 1 000');
select is((select room from public.advance_limit(pg_temp.w(2))), 500.00, 'Лимит уменьшился на открытый аванс');
set local request.jwt.claim.sub = '77000003-0000-0000-0000-000000000000';
select throws_ok($$select * from public.advance_limit(pg_temp.w(2))$$, '42501', null, 'Чужой лимит смотреть нельзя');
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select public.decide_advance((select id from public.worker_advances limit 1), true)$$, '42501', null, 'Продавец аванс не согласует');
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select lives_ok($$select public.decide_advance((select id from public.worker_advances limit 1), true)$$, 'Бухгалтер согласует аванс');

create temp table adv as select public.build_payout_registries(private.default_org_id(), current_date - 30, current_date, 'advance') as r;
grant select on adv to authenticated;
select is((select jsonb_array_length(r->'registries') from adv), 1, 'Реестр аванса: один (банк)');
select is((select (r->'registries'->0->>'total')::numeric from adv), 1000.00, 'на 1 000');
select is((select status from public.worker_advances limit 1), 'in_registry', 'Аванс в реестре');

set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select throws_ok($$select public.confirm_payout_registry((select id from public.payout_registries where kind = 'advance'))$$, '42501', null, 'Составитель реестр не подтверждает');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select lives_ok($$select public.confirm_payout_registry((select id from public.payout_registries where kind = 'advance'))$$, 'Руководитель подтверждает реестр аванса');
reset role;
select private.mark_line_paid((select id from public.payout_lines limit 1), 'bank-1', null);
select is((select status || '/' || remaining from public.worker_advances limit 1), 'issued/1000.00', 'Выплаченный аванс выдан и подлежит удержанию');

-- ------------------------------------------------------------
-- Реестр выплат
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'ec000000-0000-0000-0000-0000000000ec';
select throws_ok($$select public.build_payout_registries(private.default_org_id(), current_date - 30, current_date)$$, '42501', null, 'Рекрутер реестр не собирает');
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
create temp table pay as select public.build_payout_registries(private.default_org_id(), current_date - 30, current_date) as r;
grant select on pay to authenticated;
select is((select jsonb_array_length(r->'registries') from pay), 2, 'Реестр сам разделился на два канала');
select is((select r->>'excluded' from pay), '2', 'Двое исключены');
select is((select channel || '/' || lines_count || '/' || total_amount from public.payout_registries where kind = 'payment' and channel = 'platform'), 'platform/1/3000.00', 'Платформа: один самозанятый, 3 000');
select is((select channel || '/' || lines_count || '/' || total_amount from public.payout_registries where kind = 'payment' and channel = 'bank'), 'bank/2/5000.00', 'Банк: двое, 2 000 (после аванса) + 3 000');
select is((select advance_held || '/' || amount_to_pay from public.payout_lines where worker_id = pg_temp.w(2) and registry_id in (select id from public.payout_registries where kind = 'payment')),
          '1000.00/2000.00', 'У ИП удержан аванс 1 000, к перечислению 2 000');
select is((select ndfl || '/' || contributions from public.payout_lines where worker_id = pg_temp.w(3)), '448.28/1034.48', 'У ГПХ посчитаны НДФЛ и взносы для отчёта');
select is((select count(*)::int from public.accruals where status = 'in_registry'), 3, 'Начисления трёх исполнителей в реестрах');
select is((select reasons[1] from public.payout_exclusions where worker_id = pg_temp.w(4)), 'Нет подтверждённых реквизитов', 'Без реквизитов не включён, причина названа');
select ok((select 'Самозанятый снят с учёта в ФНС' = any(reasons) from public.payout_exclusions where worker_id = pg_temp.w(5)), 'Снятый с учёта самозанятый не включён');
select is((select status from public.worker_advances limit 1), 'repaid', 'Аванс полностью удержан');
select is((select r->>'excluded' from (select public.build_payout_registries(private.default_org_id(), current_date - 30, current_date) as r) x), '2', 'Повторная сборка: уже включённые второй раз не берутся, исключённые остаются исключёнными');

-- Строку можно убрать до подтверждения
select lives_ok($$select public.remove_payout_line((select id from public.payout_lines where worker_id = pg_temp.w(3)), 'Спорная выплата')$$, 'Строку можно убрать до подтверждения');
select is((select total_amount from public.payout_registries where kind = 'payment' and channel = 'bank'), 2000.00, 'Итог реестра пересчитан');
select is((select status from public.accruals where worker_id = pg_temp.w(3)), 'approved', 'Начисления убранного вернулись в «утверждено»');
select throws_ok($$delete from public.payout_lines$$, '42501', null, 'Напрямую строки не удаляются');

-- Подтверждение и отмена
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select lives_ok($$select public.confirm_payout_registry((select id from public.payout_registries where kind = 'payment' and channel = 'bank'))$$, 'Руководитель подтверждает банковский реестр');
select throws_ok($$select public.remove_payout_line((select id from public.payout_lines where worker_id = pg_temp.w(2) and gross = 3000), 'Поздно')$$, '22023', null, 'После подтверждения строку убрать нельзя');
reset role;
select throws_ok($$update public.payout_lines set amount_to_pay = 1$$, '22023', null, 'Суммы подтверждённой строки не меняются');
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select lives_ok($$select public.cancel_payout_registry((select id from public.payout_registries where kind = 'payment' and channel = 'bank'), 'Ошибка в составе')$$, 'Подтверждённый, но не отправленный реестр можно аннулировать');
select is((select status || '/' || remaining from public.worker_advances limit 1), 'issued/1000.00', 'Аванс вернулся к удержанию');
select is((select status from public.accruals where worker_id = pg_temp.w(2)), 'approved', 'Начисления вернулись');

-- Ошибка строки возвращает сумму в «к выплате», остальные проводятся
reset role;
update public.payout_registries set status = 'sent' where kind = 'payment' and channel = 'platform';
select private.mark_line_paid((select id from public.payout_lines where worker_id = pg_temp.w(1)), 'platform-1', 'https://lknpd.nalog.ru/receipt/1');
select is((select status from public.payout_registries where kind = 'payment' and channel = 'platform'), 'paid', 'Единственная строка проведена — реестр «проведён»');
select is((select status from public.accruals where worker_id = pg_temp.w(1)), 'paid', 'Начисления выплаченного — «выплачено»');
select is((select receipt from public.payout_lines where worker_id = pg_temp.w(1)), 'https://lknpd.nalog.ru/receipt/1', 'Чек НПД сохранён');

set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
create temp table pay2 as select public.build_payout_registries(private.default_org_id(), current_date - 30, current_date) as r;
reset role;
update public.payout_registries set status = 'sent' where kind = 'payment' and status = 'composed';
select private.mark_line_paid((select id from public.payout_lines where worker_id = pg_temp.w(2) and status = 'pending'), 'bank-2', null);
select private.mark_line_error((select id from public.payout_lines where worker_id = pg_temp.w(3) and status = 'pending'), 'Карта закрыта');
select is((select status from public.payout_registries where id = (select (r->'registries'->0->>'id')::uuid from pay2)), 'errors', 'Есть ошибочная строка — реестр «ошибки», остальные проведены');
select is((select status from public.accruals where worker_id = pg_temp.w(3)), 'approved', 'Сумма ошибочной строки вернулась в «к выплате»');
select is((select error_text from public.payout_lines where worker_id = pg_temp.w(3) and status = 'error'), 'Карта закрыта', 'Текст ошибки сохранён');

set local role authenticated;
set local request.jwt.claim.sub = '77000001-0000-0000-0000-000000000000';
select is((select count(*)::int from public.payout_registries), 0, 'Исполнитель реестров не видит');
select * from finish();
rollback;
