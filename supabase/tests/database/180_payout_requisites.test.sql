-- Шаг 17: реквизиты исполнителей и защита самозанятых.
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
  ('ec000000-0000-0000-0000-0000000000ec', 'rec@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 3) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'recruiter' where user_id = 'ec000000-0000-0000-0000-0000000000ec';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting'),
  ('ec000000-0000-0000-0000-0000000000ec', 'Рекрутер', 'hiring'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');
update public.workers set tax_status = case user_id when pg_temp.w(1) then 'self_employed' when pg_temp.w(2) then 'ip' else 'gph' end
 where user_id in (select pg_temp.w(i) from generate_series(1, 3) i);

-- ------------------------------------------------------------
-- Реквизиты
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '77000001-0000-0000-0000-000000000000';
select lives_ok($$select public.submit_payout_requisites(pg_temp.w(1), 'platform', '+79000000001')$$, 'Исполнитель присылает свои реквизиты');
select is((select status from public.my_payout_requisites()), 'pending', 'Реквизиты исполнителя ждут подтверждения');
select throws_ok($$select public.submit_payout_requisites(pg_temp.w(2), 'bank_card', '4276 0000 0000 0000')$$, '42501', null, 'За другого исполнителя реквизиты не прислать');
select throws_ok($$select public.submit_payout_requisites(pg_temp.w(1), 'platform', '123')$$, '22023', null, 'Неполные реквизиты не принимаются');
select ok((select masked from public.my_payout_requisites()) not like '%9000000001%', 'Исполнитель видит только маску');
select throws_ok($$select * from public.payout_requisites$$, '42501', null, 'Таблица реквизитов закрыта для клиента');

set local request.jwt.claim.sub = 'ec000000-0000-0000-0000-0000000000ec';
select throws_ok($$select public.decide_payout_requisites((select id from public.my_payout_requisites() limit 1), true)$$, '42501', null, 'Рекрутер реквизиты не подтверждает');

set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select count(*)::int from public.payout_requisites_queue(private.default_org_id()) where status = 'pending'), 1, 'У бухгалтера одна заявка на подтверждение');
select lives_ok($$select public.decide_payout_requisites((select id from public.payout_requisites_queue(private.default_org_id()) where status = 'pending'), true)$$, 'Бухгалтер подтверждает');
select is((select string_agg(status, ',') from public.payout_requisites_queue(private.default_org_id())), 'confirmed', 'Реквизиты подтверждены');

-- Бухгалтер вносит реквизиты за исполнителей сразу подтверждёнными
select lives_ok($$select public.submit_payout_requisites(pg_temp.w(2), 'bank_account', '40817810000000000002, БИК 044525225')$$, 'Бухгалтер вносит реквизиты ИП');
select lives_ok($$select public.submit_payout_requisites(pg_temp.w(3), 'bank_card', '4276000000000003')$$, 'и ГПХ');
select is((select count(*)::int from public.payout_requisites_queue(private.default_org_id()) where status = 'confirmed'), 3, 'Подтверждённых реквизитов три');
select is(public.reveal_payout_requisites(pg_temp.w(2)), '40817810000000000002, БИК 044525225', 'Бухгалтер открывает полные реквизиты');
reset role;
select ok(exists (select 1 from public.audit_log where table_name = 'payout_requisites' and note = 'открыты реквизиты выплаты'), 'Просмотр записан в журнал');
set local role authenticated;
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select public.reveal_payout_requisites(pg_temp.w(2))$$, '42501', null, 'Продавец реквизиты не открывает');
select throws_ok($$select * from public.payout_eligibility(pg_temp.w(2))$$, '42501', null, 'и допуск к выплате не смотрит');

-- ------------------------------------------------------------
-- Допуск к выплате
-- ------------------------------------------------------------
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select eligible || '/' || channel from public.payout_eligibility(pg_temp.w(2))), 'true/bank', 'ИП с подтверждёнными реквизитами допущен, канал — банк');
select is((select eligible || '/' || channel from public.payout_eligibility(pg_temp.w(3))), 'true/bank', 'ГПХ тоже');
select ok((select 'Статус самозанятого не проверен в ФНС (проверка старше трёх суток)' = any(reasons) from public.payout_eligibility(pg_temp.w(1))), 'Самозанятый без проверки ФНС не допущен');

-- Статус самозанятого проверяется по ИНН
select lives_ok($$select public.set_person_secret('worker', pg_temp.w(1), 'inn', '561200000001')$$, 'Бухгалтер вносит ИНН самозанятого');
reset role;
set local role service_role;
select is((select inn from public.list_npd_checks(10) where worker_id = pg_temp.w(1)), '561200000001', 'Для проверки ИНН расшифровывается только служебной ролью');
select is((select count(*)::int from public.list_npd_checks(10)), 1, 'В проверку попадают только самозанятые с ИНН');
select lives_ok($$select public.record_npd_status(pg_temp.w(1), 'active', 'Является плательщиком НПД')$$, 'Результат проверки записывается');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select eligible || '/' || channel from public.payout_eligibility(pg_temp.w(1))), 'true/platform', 'Проверенный самозанятый допущен, канал — платформа');
reset role;
set local role service_role;
select is((select count(*)::int from public.list_npd_checks(10)), 0, 'Только что проверенного повторно не берём');
select lives_ok($$select public.record_npd_status(pg_temp.w(1), 'inactive', 'Не является плательщиком НПД')$$, 'ФНС: снят с учёта');
reset role;
select ok(exists (select 1 from public.staff_tasks where kind = 'npd_inactive' and related_id = pg_temp.w(1)), 'Рекрутеру поставлена задача');
select ok(exists (select 1 from public.notifications where event = 'payout_blocked' and user_id = 'ac000000-0000-0000-0000-0000000000ac'), 'Бухгалтеру пришло уведомление');
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select ok((select 'Самозанятый снят с учёта в ФНС' = any(reasons) from public.payout_eligibility(pg_temp.w(1))), 'Снятый с учёта не допущен');
reset role;
select public.record_npd_status(pg_temp.w(1), 'active', 'Восстановлен');
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';

-- Стоп выплат
select throws_ok($$select public.set_payout_stop(pg_temp.w(2), true, '')$$, '22023', null, 'Стоп выплат без причины невозможен');
select lives_ok($$select public.set_payout_stop(pg_temp.w(2), true, 'Спор о долге')$$, 'Бухгалтер ставит стоп выплат');
select ok((select 'Выплаты остановлены: Спор о долге' = any(reasons) from public.payout_eligibility(pg_temp.w(2))), 'Исполнитель с остановленными выплатами не допущен');
select lives_ok($$select public.set_payout_stop(pg_temp.w(2), false)$$, 'Стоп снимается');

-- Смена реквизитов самим исполнителем блокирует выплаты до подтверждения
set local request.jwt.claim.sub = '77000002-0000-0000-0000-000000000000';
select lives_ok($$select public.submit_payout_requisites(pg_temp.w(2), 'bank_card', '4276999999999999')$$, 'Исполнитель меняет реквизиты');
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select ok((select 'Реквизиты изменены и ждут подтверждения бухгалтера' = any(reasons) from public.payout_eligibility(pg_temp.w(2))), 'Выплаты приостановлены до подтверждения');
select lives_ok($$select public.decide_payout_requisites((select id from public.payout_requisites_queue(private.default_org_id()) where status = 'pending'), false, 'Не совпадает с договором')$$, 'Бухгалтер отклоняет новые реквизиты');
select is((select eligible from public.payout_eligibility(pg_temp.w(2))), true, 'После отказа действуют прежние подтверждённые реквизиты');

-- Недавний трудовой договор запрещает самозанятость
select lives_ok($$select public.set_employment_end(pg_temp.w(1), current_date - 300)$$, 'Вносится дата увольнения по трудовому договору');
select ok((select exists (select 1 from unnest(reasons) r where r like 'Работал по трудовому договору менее 2 лет назад%') from public.payout_eligibility(pg_temp.w(1))), 'Менее двух лет назад — выплаты как самозанятому запрещены');
select lives_ok($$select public.set_employment_end(pg_temp.w(1), current_date - 800)$$, 'Больше двух лет назад');
select is((select eligible from public.payout_eligibility(pg_temp.w(1))), true, 'и запрет снят');

select * from finish();
rollback;
