-- Шаг 30: импорт из Excel.
-- Приёмка из ТЗ (раздел 18): импорт 500 исполнителей с 10 ошибками загружает 490 и показывает 10 строк с причинами.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(32);

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('ac000000-0000-0000-0000-0000000000ac', 'acc@test.local'),
  ('4e000000-0000-0000-0000-0000000000e1', 'rec@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('70000000-0000-0000-0000-000000000001', 'w1@test.local');
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'recruiter' where user_id = '4e000000-0000-0000-0000-0000000000e1';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting'),
  ('4e000000-0000-0000-0000-0000000000e1', 'Рекрутер', 'hiring'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');
-- Существующий исполнитель с телефоном
update public.workers set phone = '+7 901 000 0007' where user_id = '70000000-0000-0000-0000-000000000001';

-- 500 строк: на каждой пятидесятой — ошибка (то нет ФИО, то телефон неверный)
create temp table big as
  select jsonb_agg(case when i % 50 = 0 and i % 100 = 0 then jsonb_build_object('full_name', '', 'phone', '+7900' || lpad(i::text, 7, '0'))
                        when i % 50 = 0 then jsonb_build_object('full_name', 'Кандидат ' || i, 'phone', 'нет номера')
                        else jsonb_build_object('full_name', 'Кандидат ' || i, 'phone', '+7900' || lpad(i::text, 7, '0'), 'city', 'Оренбург') end) as rows
  from generate_series(1, 500) i;
grant select on big to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '4e000000-0000-0000-0000-0000000000e1';

-- Предпросмотр ничего не записывает
create temp table pv as select * from public.import_rows(private.default_org_id(), 'candidates', (select rows from big), false);
select is((select count(*)::int from pv), 500, 'Предпросмотр вернул ответ по каждой строке');
select is((select count(*)::int from pv where result = 'created'), 490, 'В предпросмотре создаётся 490');
select is((select count(*)::int from pv where result = 'error'), 10, 'и 10 строк с ошибками');
select ok((select bool_and(message <> '' and message is not null) from pv where result = 'error'), 'у каждой ошибки есть причина');
select is((select min(row_no) from pv where result = 'error'), 51, 'Номер строки совпадает со строкой файла (заголовок — первая)');
select is((select count(*)::int from public.candidates), 0, 'Предпросмотр ничего не сохранил');

-- Загрузка
create temp table ap as select * from public.import_rows(private.default_org_id(), 'candidates', (select rows from big), true);
select is((select count(*)::int from ap where result = 'created'), 490, 'Загружено 490 кандидатов');
select is((select count(*)::int from public.candidates), 490, 'они есть в базе');
select is((select count(*)::int from public.candidates where recruiter_id = '4e000000-0000-0000-0000-0000000000e1'), 490, 'ответственным стал загрузивший рекрутёр');
select is((select count(*)::int from public.candidates c join public.directories d on d.id = c.source_id where d.name = 'Импорт из Excel'), 490, 'Источник — «Импорт из Excel»');

-- Дубли по телефону
create temp table two as select jsonb_build_array(
  jsonb_build_object('full_name', 'Кандидат 1', 'phone', '8 (900) 000-00-01', 'city', 'Самара'),
  jsonb_build_object('full_name', 'Из таблицы', 'phone', '+7 901 000 0007')) as rows;
grant select on two to authenticated;
select is((select result from public.import_rows(private.default_org_id(), 'candidates', (select rows from two), true, 'skip') where row_no = 2), 'skipped', 'Дубль по телефону пропускается');
select is((select city from public.candidates where full_name = 'Кандидат 1'), 'Оренбург', 'и данные не меняются');
select is((select result from public.import_rows(private.default_org_id(), 'candidates', (select rows from two), true, 'update') where row_no = 2), 'updated', 'Дубль можно обновить: телефон в другом написании тот же');
select is((select city from public.candidates where full_name = 'Кандидат 1'), 'Самара', 'обновление применено');
select ok((select message from public.import_rows(private.default_org_id(), 'candidates', (select rows from two), false) where row_no = 3) like 'Уже есть исполнитель%', 'Телефон исполнителя не даёт завести кандидата');

-- Права
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select throws_ok($$select * from public.import_rows(private.default_org_id(), 'candidates', '[]'::jsonb)$$, '42501', null, 'Бухгалтер кандидатов не загружает');
set local request.jwt.claim.sub = '4e000000-0000-0000-0000-0000000000e1';
select throws_ok($$select * from public.import_rows(private.default_org_id(), 'clients', '[]'::jsonb)$$, '42501', null, 'Рекрутёр заказчиков не загружает');
select throws_ok($$select * from public.import_rows(private.default_org_id(), 'planets', '[]'::jsonb)$$, '22023', null, 'Неизвестный вид импорта');

-- Заказчики
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
create temp table cl as select jsonb_build_array(
  jsonb_build_object('name', 'ООО Альфа', 'inn', '5612345678', 'city', 'Оренбург', 'status', 'active'),
  jsonb_build_object('name', 'ООО Бета', 'inn', '123'),
  jsonb_build_object('name', 'ИП Гамма', 'status', 'вечный'),
  jsonb_build_object('name', '', 'inn', '5612345679'),
  jsonb_build_object('name', 'ООО Альфа-дубль', 'inn', '5612345678')) as rows;
grant select on cl to authenticated;
create temp table clr as select * from public.import_rows(private.default_org_id(), 'clients', (select rows from cl), true);
select is((select result from clr where row_no = 2), 'created', 'Заказчик создан');
select ok((select message from clr where row_no = 3) like 'ИНН должен%', 'Неверный ИНН отвергается с причиной');
select ok((select message from clr where row_no = 4) like 'Статус:%', 'Неверный статус отвергается');
select is((select result from clr where row_no = 6), 'skipped', 'Дубль по ИНН пропущен');
select is((select sales_manager_id from public.clients where name = 'ООО Альфа'), '51000000-0000-0000-0000-000000000001'::uuid, 'Заказчика ведёт менеджер, загрузивший файл');

-- Объекты и тарифы (руководитель)
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
create temp table st as select jsonb_build_array(
  jsonb_build_object('client', 'ооо альфа', 'name', 'Склад Север', 'address', 'ул. Складская, 1', 'latitude', '51,7682', 'longitude', '55.097', 'checkin_method', 'geo'),
  jsonb_build_object('client', 'Нет такого', 'name', 'Склад Юг'),
  jsonb_build_object('client', 'ООО Альфа', 'name', 'Склад Запад', 'latitude', '95')) as rows;
grant select on st to authenticated;
create temp table str as select * from public.import_rows(private.default_org_id(), 'sites', (select rows from st), true);
select is((select result from str where row_no = 2), 'created', 'Объект создан (заказчик найден без учёта регистра)');
select is((select status from public.sites where name = 'Склад Север'), 'launch', 'и стоит на запуске');
select ok((select message from str where row_no = 3) like 'Заказчик «Нет такого» не найден%', 'Неизвестный заказчик объекта — понятная причина');
select ok((select message from str where row_no = 4) like 'Широта%', 'Широта вне диапазона отвергается');

create temp table tr as select jsonb_build_array(
  jsonb_build_object('client', 'ООО Альфа', 'site', 'Склад Север', 'position', 'Грузчик', 'client_rate', '450,50', 'worker_rate', '300', 'valid_from', '01.11.2026'),
  jsonb_build_object('client', 'ООО Альфа', 'position', 'Несуществующая', 'client_rate', '1', 'worker_rate', '1', 'valid_from', '2026-11-01'),
  jsonb_build_object('client', 'ООО Альфа', 'position', 'Грузчик', 'client_rate', '450', 'valid_from', '2026-11-01')) as rows;
grant select on tr to authenticated;
create temp table trr as select * from public.import_rows(private.default_org_id(), 'tariffs', (select rows from tr), true);
select is((select result from trr where row_no = 2), 'created', 'Тариф создан');
select is((select client_rate from public.tariffs where note = 'Импорт из Excel'), 450.50, 'Десятичная запятая разобрана');
select is((select status from public.tariffs where note = 'Импорт из Excel'), 'draft', 'Тариф — черновик, утверждать его нужно отдельно');
select ok((select message from trr where row_no = 3) like 'Позиция «Несуществующая»%', 'Неизвестная позиция — причина');
select ok((select message from trr where row_no = 4) like 'Укажите обе ставки%', 'Без ставки тариф не создаётся');

select * from finish();
rollback;
