-- Шаг 4: заказчики, договоры, тарифы.
-- Приёмка из ТЗ (раздел 7): менеджер создаёт заказчика, договор и тариф с маржой 15%; тариф уходит
-- на согласование руководителю и до утверждения недоступен; изменение ставки не меняет созданное.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(70);

create function pg_temp.rows_changed(_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute _sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.rows_changed(text) to authenticated;

-- Организация 1: A — администратор системы, D — руководитель, SH — руководитель отдела продаж,
-- S1 и S2 — менеджеры по продажам, SM — менеджер объекта, AC — бухгалтер, CU — человек из кабинета заказчика.
-- Организация 2: B — администратор.
insert into public.organizations (id, name) values ('b2000000-0000-0000-0000-000000000002', 'Вторая организация');
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'a@test.local'),
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('5e000000-0000-0000-0000-0000000000a1', 'sh@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('52000000-0000-0000-0000-000000000002', 's2@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('ac000000-0000-0000-0000-0000000000ac', 'ac@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'b@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'cu@test.local');
update public.user_roles set role = 'admin' where user_id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'sales' where user_id in ('5e000000-0000-0000-0000-0000000000a1', '51000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000002');
update public.user_roles set role = 'site_manager' where user_id = '5c000000-0000-0000-0000-0000000000c1';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'client_admin' where user_id = 'c0000000-0000-0000-0000-00000000000c';
update public.user_roles set org_id = 'b2000000-0000-0000-0000-000000000002' where user_id = 'b0000000-0000-0000-0000-00000000000b';
insert into public.staff_profiles (user_id, full_name, department, is_department_head) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management', false),
  ('5e000000-0000-0000-0000-0000000000a1', 'Глава продаж', 'sales', true),
  ('51000000-0000-0000-0000-000000000001', 'Продавец Один', 'sales', false),
  ('52000000-0000-0000-0000-000000000002', 'Продавец Два', 'sales', false),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта', 'sites', false),
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting', false);

insert into public.clients (id, org_id, name, inn, sales_manager_id, sites_manager_id) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '5610000001', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1'),
  ('c2000000-0000-0000-0000-000000000002', private.default_org_id(), 'Заказчик 2', '5610000002', '52000000-0000-0000-0000-000000000002', null);
insert into public.client_contacts (org_id, client_id, full_name, user_id, cabinet_role)
  values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Контакт кабинета', 'c0000000-0000-0000-0000-00000000000c', 'client_admin');

select is((select count(*)::int from public.positions where org_id = private.default_org_id()), 7, 'Позиции из прежнего списка заведены');

-- ------------------------------------------------------------
-- Расчёт маржи (примеры из раздела 11: 450 ₽ заказчику, 300 ₽ исполнителю на руки)
-- ------------------------------------------------------------
select is((select margin from public.calc_margins(private.default_org_id(), 450, 300) where status = 'ip'), 150.00, 'ИП: маржа 150 ₽');
select is((select margin_pct from public.calc_margins(private.default_org_id(), 450, 300) where status = 'ip'), 33.3, 'ИП: 33,3%');
select is((select cost from public.calc_margins(private.default_org_id(), 450, 300) where status = 'self_employed'), 306.00, 'Самозанятый: себестоимость 306 ₽ (комиссия 2%)');
select is((select margin_pct from public.calc_margins(private.default_org_id(), 450, 300) where status = 'self_employed'), 32.0, 'Самозанятый: 32,0%');
select is((select taxes from public.calc_margins(private.default_org_id(), 450, 300) where status = 'gph'), 148.28, 'ГПХ: налоги и взносы 148,28 ₽ на единицу');
select is((select margin_pct from public.calc_margins(private.default_org_id(), 450, 300) where status = 'gph'), 0.4, 'ГПХ: 0,4% — исполнитель съедает почти всю маржу');

-- ------------------------------------------------------------
-- Менеджер по продажам S1: видит и правит только своих
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';

select is((select count(*)::int from public.clients), 1, 'Менеджер по продажам видит только своих заказчиков');
select is(pg_temp.rows_changed($$update public.clients set notes = 'правка' where id = 'c1000000-0000-0000-0000-000000000001'$$), 1, 'Правит своего');
select is(pg_temp.rows_changed($$update public.clients set notes = 'чужой' where id = 'c2000000-0000-0000-0000-000000000002'$$), 0, 'Чужого не правит');
select lives_ok(
  $$insert into public.clients (org_id, name, sales_manager_id) values (private.default_org_id(), 'Новый заказчик', '51000000-0000-0000-0000-000000000001')$$,
  'Заводит заказчика на себя'
);
select throws_ok(
  $$insert into public.clients (org_id, name, sales_manager_id) values (private.default_org_id(), 'На чужого', '52000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'Нельзя завести заказчика на другого менеджера'
);
select is(pg_temp.rows_changed($$delete from public.clients where id = 'c1000000-0000-0000-0000-000000000001'$$), 0, 'Заказчиков не удаляют, а архивируют');
select throws_ok($$update public.clients set status = 'archived' where id = 'c1000000-0000-0000-0000-000000000001'$$, '23514', null, 'Архив без причины отклоняется');
select lives_ok($$update public.clients set status = 'archived', archive_reason = 'Договор расторгнут' where id = 'c1000000-0000-0000-0000-000000000001'$$, 'Архив с причиной');
select lives_ok($$update public.clients set status = 'negotiation', archive_reason = null where id = 'c1000000-0000-0000-0000-000000000001'$$, 'Из архива можно вернуть');
select throws_ok($$update public.clients set inn = '5610000002' where id = 'c1000000-0000-0000-0000-000000000001'$$, '23505', null, 'ИНН уникален в организации');
select throws_ok($$update public.clients set inn = '123' where id = 'c1000000-0000-0000-0000-000000000001'$$, '23514', null, 'ИНН из неверного числа цифр отклоняется');

-- Контакты и договоры
select lives_ok($$insert into public.client_contacts (org_id, client_id, full_name) values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Иван Контактов')$$, 'Менеджер добавляет контакт');
select throws_ok(
  $$insert into public.client_contacts (org_id, client_id, full_name, user_id, cabinet_role)
    values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Доступ себе', '51000000-0000-0000-0000-000000000001', 'client_admin')$$,
  '42501', null, 'Доступ в кабинет менеджер продаж выдать не может'
);
select throws_ok($$insert into public.client_contacts (org_id, client_id, full_name) values (private.default_org_id(), 'c2000000-0000-0000-0000-000000000002', 'В чужого')$$, '42501', null, 'Контакт чужому заказчику не добавить');
select lives_ok(
  $$insert into public.contracts (org_id, client_id, number, signed_on, billing_period, payment_delay_days)
    values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Д-1', current_date, 'two_weeks', 10)$$,
  'Менеджер заводит договор'
);
select throws_ok(
  $$insert into public.contracts (org_id, client_id, number, signed_on)
    values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Д-1', current_date)$$,
  '23505', null, 'Номер договора уникален у заказчика'
);
select throws_ok(
  $$insert into public.contracts (org_id, client_id, number, signed_on, valid_until)
    values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Д-2', current_date, current_date - 5)$$,
  '23514', null, 'Срок договора не раньше даты подписания'
);
select throws_ok(
  $$insert into public.contracts (org_id, client_id, number, signed_on) values (private.default_org_id(), 'c2000000-0000-0000-0000-000000000002', 'Д-9', current_date)$$,
  '42501', null, 'Договор чужому заказчику не завести'
);

-- ------------------------------------------------------------
-- Тарифы: путь от черновика до утверждения
-- ------------------------------------------------------------
select lives_ok(
  $$insert into public.tariffs (id, org_id, client_id, position_id, client_rate, worker_rate, valid_from)
    select 'f1000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик'$$,
  'Менеджер заводит тариф-черновик'
);
select throws_ok(
  $$insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
    select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date, 'approved'
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Упаковщик'$$,
  '42501', null, 'Сразу утверждённым тариф завести нельзя'
);
select throws_ok($$update public.tariffs set status = 'approved' where id = 'f1000000-0000-0000-0000-000000000001'$$, '42501', null,
  'Статус меняется только через согласование');
select is(public.get_tariff('c1000000-0000-0000-0000-000000000001', null,
  (select id from public.positions where org_id = private.default_org_id() and name = 'Грузчик'), 'hour') is null, true,
  'Черновик в заказах недоступен');
select lives_ok($$select public.set_tariff_status('f1000000-0000-0000-0000-000000000001', 'pending')$$, 'Тариф уходит на согласование');
select throws_ok($$select public.set_tariff_status('f1000000-0000-0000-0000-000000000001', 'approved')$$, '42501', null,
  'Менеджер сам себе тариф не утверждает');
select throws_ok($$update public.tariffs set client_rate = 999 where id = 'f1000000-0000-0000-0000-000000000001'$$, '22023', null,
  'Тариф на согласовании не правится');

-- Руководитель отдела продаж утверждает тариф с маржой не ниже порога
set local request.jwt.claim.sub = '5e000000-0000-0000-0000-0000000000a1';
select lives_ok($$select public.set_tariff_status('f1000000-0000-0000-0000-000000000001', 'approved')$$, 'Руководитель отдела продаж утверждает тариф с маржой 32%');

-- Низкая маржа: утверждает только руководитель компании
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into public.tariffs (id, org_id, client_id, position_id, client_rate, worker_rate, valid_from)
    select 'f2000000-0000-0000-0000-000000000002', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 395, current_date
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Упаковщик'$$,
  'Тариф с низкой маржой заводится'
);
select lives_ok($$select public.set_tariff_status('f2000000-0000-0000-0000-000000000002', 'pending')$$, 'и уходит на согласование');
set local request.jwt.claim.sub = '5e000000-0000-0000-0000-0000000000a1';
select throws_ok($$select public.set_tariff_status('f2000000-0000-0000-0000-000000000002', 'approved')$$, '42501', null,
  'Маржа ниже порога: руководитель отдела продаж утвердить не может');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select lives_ok($$select public.set_tariff_status('f2000000-0000-0000-0000-000000000002', 'approved')$$, 'Руководитель компании утверждает');
select ok(
  exists (select 1 from public.audit_log where table_name = 'tariffs' and record_id = 'f2000000-0000-0000-0000-000000000002' and field = 'status' and new_value = 'approved'),
  'Утверждение записано в журнал'
);

-- Утверждённый тариф доступен заказам; новая версия закрывает прежнюю накануне
select is(
  (select client_rate from public.get_tariff('c1000000-0000-0000-0000-000000000001', null,
    (select id from public.positions where org_id = private.default_org_id() and name = 'Грузчик'), 'hour')),
  450.00, 'Утверждённый тариф находится для заказа'
);

set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select lives_ok($$select public.new_tariff_version('f1000000-0000-0000-0000-000000000001', 470, 300, current_date + 30)$$, 'Менеджер создаёт новую версию тарифа');
select throws_ok($$select public.new_tariff_version('f1000000-0000-0000-0000-000000000001', 470, 300, current_date - 1)$$, '22023', null, 'Новая версия не начинается в прошлом');

set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select lives_ok(
  $$select public.set_tariff_status(t.id, 'pending') from public.tariffs t where t.client_rate = 470$$,
  'Новая версия уходит на согласование'
);
select lives_ok(
  $$select public.set_tariff_status(t.id, 'approved') from public.tariffs t where t.client_rate = 470$$,
  'и утверждается'
);
select is(
  (select valid_to from public.tariffs where id = 'f1000000-0000-0000-0000-000000000001'), (current_date + 29),
  'Прежняя версия закончилась накануне новой'
);
select is(
  (select client_rate from public.get_tariff('c1000000-0000-0000-0000-000000000001', null,
    (select id from public.positions where org_id = private.default_org_id() and name = 'Грузчик'), 'hour', current_date + 29)),
  450.00, 'До даты новой версии действует старая ставка'
);
select is(
  (select client_rate from public.get_tariff('c1000000-0000-0000-0000-000000000001', null,
    (select id from public.positions where org_id = private.default_org_id() and name = 'Грузчик'), 'hour', current_date + 30)),
  470.00, 'С даты новой версии — новая'
);

-- Пересечение периодов утверждённых тарифов с одним ключом запрещено
reset role;
insert into public.tariffs (id, org_id, client_id, position_id, client_rate, worker_rate, valid_from)
  select 'f3000000-0000-0000-0000-000000000003', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 460, 300, current_date
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select lives_ok($$select public.set_tariff_status('f3000000-0000-0000-0000-000000000003', 'pending')$$, 'Тариф-двойник уходит на согласование');
select throws_ok($$select public.set_tariff_status('f3000000-0000-0000-0000-000000000003', 'approved')$$, '23P01', null,
  'Пересекающийся по периоду тариф не утверждается');

-- Объектный тариф важнее общего
reset role;
insert into public.sites (id, name, client_id) values ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001');
insert into public.tariffs (id, org_id, client_id, site_id, position_id, client_rate, worker_rate, valid_from, status)
  select 'f4000000-0000-0000-0000-000000000004', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id, 520, 330, current_date, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select is(
  (select client_rate from public.get_tariff('c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001',
    (select id from public.positions where org_id = private.default_org_id() and name = 'Грузчик'), 'hour')),
  520.00, 'Тариф на объект важнее общего'
);

-- Черновик можно удалить, действующий тариф нет
set local role authenticated;
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select is(pg_temp.rows_changed($$delete from public.tariffs where id = 'f1000000-0000-0000-0000-000000000001'$$), 0, 'Утверждённый тариф не удаляется');
select is(pg_temp.rows_changed($$delete from public.tariffs where id = 'f3000000-0000-0000-0000-000000000003'$$), 0, 'Тариф на согласовании не удаляется');

-- ------------------------------------------------------------
-- Остальные роли
-- ------------------------------------------------------------
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select ok((select count(*) from public.tariffs) > 0, 'Бухгалтер читает тарифы');
select throws_ok(
  $$insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from)
    select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 1, 1, current_date from public.positions p limit 1$$,
  '42501', null, 'Но не заводит'
);

set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select is((select count(*)::int from public.clients), 3, 'Менеджер объекта читает всех заказчиков организации');
select is(pg_temp.rows_changed($$update public.clients set notes = 'x'$$), 0, 'но не правит');

set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select is((select count(*)::int from public.clients), 1, 'Человек из кабинета видит только свою компанию');
select is((select count(*)::int from public.tariffs), 0, 'и не видит тарифы: в них ставка исполнителя');

set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
select is((select count(*)::int from public.clients), 0, 'Администратор другой организации не видит заказчиков');
select is((select count(*)::int from public.tariffs), 0, 'и тарифы');

set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
select ok((select count(*) from public.clients) > 0, 'Администратор системы читает заказчиков');
select throws_ok($$insert into public.clients (org_id, name) values (private.default_org_id(), 'Админ создаёт')$$, '42501', null, 'но не создаёт');

-- Передача в ведение объектов
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select lives_ok($$select public.handoff_client('c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1')$$, 'Менеджер передаёт заказчика менеджеру объекта');
select throws_ok($$select public.handoff_client('c1000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000002')$$, '22023', null, 'Ответственным за объекты может быть только менеджер объекта');
select throws_ok($$select public.handoff_client('c2000000-0000-0000-0000-000000000002', '5c000000-0000-0000-0000-0000000000c1')$$, '42501', null, 'Чужого заказчика передать нельзя');

-- ------------------------------------------------------------
-- Заказчики из HR-пользователей
-- ------------------------------------------------------------
reset role;
insert into public.clients (id, org_id, name) values ('e1000000-0000-0000-0000-0000000000e1', private.default_org_id(), 'ООО Ромашка');
insert into auth.users (id, email, raw_user_meta_data) values
  ('11000000-0000-0000-0000-000000000011', 'hr1@test.local', '{"role":"hr","company":"ООО Ромашка","full_name":"Анна HR"}'),
  ('12000000-0000-0000-0000-000000000012', 'hr2@test.local', '{"role":"hr","company":" ооо ромашка ","full_name":"Борис HR"}');
select is(
  (select count(*)::int from public.clients where lower(btrim(name)) = 'ооо ромашка'), 3,
  'Саморегистрация создаёт отдельных лидов, а не присоединяется к заказчику с тем же названием'
);
select is(
  (select count(*)::int from public.client_contacts where client_id = 'e1000000-0000-0000-0000-0000000000e1'), 0,
  'К существующему заказчику чужой человек не прикрепился'
);
select is(
  (select cabinet_role from public.client_contacts where user_id = '11000000-0000-0000-0000-000000000011'), 'client_admin',
  'Зарегистрировавшийся становится администратором кабинета своего лида'
);

-- Перенос старых данных: убираем автоматически созданных лидов, оставляя «старых» HR без заказчика
delete from public.clients where id in (select client_id from public.client_contacts where user_id in ('11000000-0000-0000-0000-000000000011', '12000000-0000-0000-0000-000000000012'));
insert into public.requests (hr_id, position, start_date, end_date, address) values
  ('11000000-0000-0000-0000-000000000011', 'Грузчик', current_date, current_date, 'Оренбург');
select is(private.migrate_hr_to_clients(), 1, 'Два HR одной компании переносятся в одного заказчика');
select is(
  (select count(*)::int from public.client_contacts cc join public.clients c on c.id = cc.client_id
    where cc.user_id in ('11000000-0000-0000-0000-000000000011', '12000000-0000-0000-0000-000000000012') and c.status = 'active'),
  2, 'У компании есть заявки, поэтому заказчик активный, оба человека — его контакты'
);
select is(private.migrate_hr_to_clients(), 0, 'Повторный перенос ничего не дублирует');

select * from finish();
rollback;
