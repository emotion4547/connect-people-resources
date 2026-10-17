-- Шаг 5: объекты, запуск объекта, QR, обязательные документы.
-- ТЗ (раздел 8, О-1, О-2): пока чек-лист не закрыт, объект в статусе «Запуск»;
-- фото кода не должно позволять отметиться позже.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(49);

create function pg_temp.rows_changed(_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute _sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.rows_changed(text) to authenticated;

-- Организация 1: A — администратор, D — руководитель, SM и SM2 — менеджеры объектов, S1 — продажи,
-- W — исполнитель, CU — человек из кабинета заказчика. Организация 2: B — администратор.
insert into public.organizations (id, name) values ('b2000000-0000-0000-0000-000000000002', 'Вторая организация');
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'a@test.local'),
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('5d000000-0000-0000-0000-0000000000d2', 'sm2@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('77000000-0000-0000-0000-000000000077', 'w@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'b@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'cu@test.local');
update public.user_roles set role = 'admin' where user_id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'site_manager' where user_id in ('5c000000-0000-0000-0000-0000000000c1', '5d000000-0000-0000-0000-0000000000d2');
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
update public.user_roles set role = 'client_admin' where user_id = 'c0000000-0000-0000-0000-00000000000c';
update public.user_roles set org_id = 'b2000000-0000-0000-0000-000000000002' where user_id = 'b0000000-0000-0000-0000-00000000000b';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта 1', 'sites'),
  ('5d000000-0000-0000-0000-0000000000d2', 'Менеджер объекта 2', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');

insert into public.clients (id, org_id, name, sales_manager_id, sites_manager_id) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1'),
  ('c2000000-0000-0000-0000-000000000002', private.default_org_id(), 'Заказчик 2', '51000000-0000-0000-0000-000000000001', '5d000000-0000-0000-0000-0000000000d2');
insert into public.client_contacts (org_id, client_id, full_name, user_id, cabinet_role)
  values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Контакт кабинета', 'c0000000-0000-0000-0000-00000000000c', 'client_admin');
insert into public.sites (id, name, client_id, site_manager_id) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1'),
  ('51e00000-0000-0000-0000-000000000002', 'Склад 2', 'c2000000-0000-0000-0000-000000000002', '5d000000-0000-0000-0000-0000000000d2');

-- ------------------------------------------------------------
-- Новый объект и чек-лист
-- ------------------------------------------------------------
select is((select status from public.sites where id = '51e00000-0000-0000-0000-000000000001'), 'launch', 'Новый объект в статусе «Запуск»');
select is((select timezone from public.sites where id = '51e00000-0000-0000-0000-000000000001'), 'Asia/Yekaterinburg', 'Часовой пояс по умолчанию — Оренбург');
select is((select count(*)::int from public.site_secrets where site_id = '51e00000-0000-0000-0000-000000000001'), 1, 'Секрет QR заведён сам');
select is((select count(*)::int from public.directories where org_id = private.default_org_id() and kind = 'document_type'), 8, 'Типы документов из ТЗ заведены');
select is(
  (select count(*)::int from private.site_checklist((select s from public.sites s where id = '51e00000-0000-0000-0000-000000000001')) where done),
  1, 'В новом объекте закрыт только пункт «менеджеры заказчика»'
);

-- ------------------------------------------------------------
-- Менеджер объекта SM
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';

select is((select count(*)::int from public.site_launch_checklist('51e00000-0000-0000-0000-000000000001')), 7, 'Чек-лист запуска — 7 пунктов');
select is(pg_temp.rows_changed($$update public.sites set address = 'Оренбург, Промышленная 1' where id = '51e00000-0000-0000-0000-000000000001'$$), 1, 'Менеджер правит свой объект');
select is(pg_temp.rows_changed($$update public.sites set address = 'чужой' where id = '51e00000-0000-0000-0000-000000000002'$$), 0, 'Чужой объект не правит');
select lives_ok(
  $$insert into public.sites (name, client_id, site_manager_id) values ('Новый склад', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1')$$,
  'Заводит объект на себя'
);
select throws_ok(
  $$insert into public.sites (name, client_id, site_manager_id) values ('На другого', 'c2000000-0000-0000-0000-000000000002', '5d000000-0000-0000-0000-0000000000d2')$$,
  '42501', null, 'Нельзя завести объект на другого менеджера'
);
select throws_ok($$update public.sites set timezone = 'Mars/Olympus' where id = '51e00000-0000-0000-0000-000000000001'$$, '22023', null, 'Неизвестный часовой пояс отклоняется');
select throws_ok($$update public.sites set latitude = 100 where id = '51e00000-0000-0000-0000-000000000001'$$, '23514', null, 'Широта вне диапазона отклоняется');
select throws_ok($$update public.sites set checkin_radius_m = 5 where id = '51e00000-0000-0000-0000-000000000001'$$, '23514', null, 'Слишком малый радиус отметки отклоняется');

-- Запуск только с закрытым чек-листом
select throws_ok($$update public.sites set status = 'active' where id = '51e00000-0000-0000-0000-000000000001'$$, '22023', null, 'Объект с открытым чек-листом не запускается');
select lives_ok(
  $$update public.sites set latitude = 51.768200, longitude = 55.097000, qr_printed_at = now(), required_docs_confirmed = true,
      instructions = 'Вход со двора, проходная №2', contact_name = 'Пётр Сменов', contact_phone = '+79000000001'
    where id = '51e00000-0000-0000-0000-000000000001'$$,
  'Менеджер закрывает пункты чек-листа'
);
select throws_ok($$update public.sites set status = 'active' where id = '51e00000-0000-0000-0000-000000000001'$$, '22023', null,
  'Без утверждённого тарифа объект всё ещё не запускается');

reset role;
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select lives_ok($$update public.sites set status = 'active' where id = '51e00000-0000-0000-0000-000000000001'$$, 'С закрытым чек-листом объект запускается');
select is((select count(*)::int from public.site_launch_checklist('51e00000-0000-0000-0000-000000000001') where not done), 0, 'Все пункты чек-листа закрыты');
reset role;
select ok(
  exists (select 1 from public.audit_log where table_name = 'sites' and field = 'status' and new_value = 'active'
          and record_id = '51e00000-0000-0000-0000-000000000001'),
  'Запуск объекта записан в журнал'
);
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';

-- ------------------------------------------------------------
-- QR объекта
-- ------------------------------------------------------------
select is(
  public.site_qr_payload('51e00000-0000-0000-0000-000000000001'), public.site_qr_payload('51e00000-0000-0000-0000-000000000001'),
  'Постоянный код не меняется'
);
select ok(starts_with(public.site_qr_payload('51e00000-0000-0000-0000-000000000001'), 'RV1.51e00000-0000-0000-0000-000000000001.'),
  'Код содержит объект');
select isnt(
  public.site_qr_payload('51e00000-0000-0000-0000-000000000001', true, timestamptz '2026-01-01 10:00:10+00'),
  public.site_qr_payload('51e00000-0000-0000-0000-000000000001', true, timestamptz '2026-01-01 10:01:10+00'),
  'Меняющийся код отличается в разных минутах'
);
select throws_ok($$select * from public.site_secrets$$, '42501', null, 'Секрет QR клиенту не отдаётся');

reset role;
select is(private.verify_site_qr(
  (select 'RV1.51e00000-0000-0000-0000-000000000001.' || private.site_code('51e00000-0000-0000-0000-000000000001', null))),
  '51e00000-0000-0000-0000-000000000001'::uuid, 'Постоянный код проходит проверку');
select is(private.verify_site_qr('RV1.51e00000-0000-0000-0000-000000000001.0000000000000000'), null, 'Неверный код не проходит');
select is(private.verify_site_qr('мусор'), null, 'Мусор вместо кода не проходит');
select is(
  private.verify_site_qr('RV1.51e00000-0000-0000-0000-000000000001.' || floor(extract(epoch from timestamptz '2026-01-01 10:00:10+00') / 60) || '.' ||
    private.site_code('51e00000-0000-0000-0000-000000000001', floor(extract(epoch from timestamptz '2026-01-01 10:00:10+00') / 60)::bigint),
    timestamptz '2026-01-01 10:00:50+00'),
  '51e00000-0000-0000-0000-000000000001'::uuid, 'Меняющийся код проходит в своей минуте'
);
select is(
  private.verify_site_qr('RV1.51e00000-0000-0000-0000-000000000001.' || floor(extract(epoch from timestamptz '2026-01-01 10:00:10+00') / 60) || '.' ||
    private.site_code('51e00000-0000-0000-0000-000000000001', floor(extract(epoch from timestamptz '2026-01-01 10:00:10+00') / 60)::bigint),
    timestamptz '2026-01-01 10:01:30+00'),
  '51e00000-0000-0000-0000-000000000001'::uuid, 'и в следующей (запас на разницу часов)'
);
select is(
  private.verify_site_qr('RV1.51e00000-0000-0000-0000-000000000001.' || floor(extract(epoch from timestamptz '2026-01-01 10:00:10+00') / 60) || '.' ||
    private.site_code('51e00000-0000-0000-0000-000000000001', floor(extract(epoch from timestamptz '2026-01-01 10:00:10+00') / 60)::bigint),
    timestamptz '2026-01-01 10:02:30+00'),
  null, 'Через две минуты фото кода уже не работает'
);

-- Перевыпуск
set local role authenticated;
set local request.jwt.claim.sub = '5d000000-0000-0000-0000-0000000000d2';
select throws_ok($$select public.reissue_site_qr('51e00000-0000-0000-0000-000000000001')$$, '42501', null, 'Чужой менеджер QR не перевыпускает');
select throws_ok($$select public.site_qr_payload('51e00000-0000-0000-0000-000000000001')$$, '42501', null, 'и не получает код чужого объекта');
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
create temp table old_code as select public.site_qr_payload('51e00000-0000-0000-0000-000000000001') as payload;
select lives_ok($$select public.reissue_site_qr('51e00000-0000-0000-0000-000000000001')$$, 'Менеджер перевыпускает QR одной кнопкой');
reset role;
select is(private.verify_site_qr((select payload from old_code)), null, 'Старый код после перевыпуска не работает');
select is((select qr_printed_at from public.sites where id = '51e00000-0000-0000-0000-000000000001'), null, 'Отметка «напечатан» сброшена');

-- ------------------------------------------------------------
-- Остальные роли
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select ok((select count(*) from public.sites) >= 3, 'Продажи читают объекты');
select is(pg_temp.rows_changed($$update public.sites set instructions = 'x'$$), 0, 'но не правят');
select throws_ok($$select public.site_qr_payload('51e00000-0000-0000-0000-000000000001')$$, '42501', null, 'и не получают QR');

set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select is(pg_temp.rows_changed($$update public.sites set instructions = 'Директор правит' where id = '51e00000-0000-0000-0000-000000000002'$$), 1, 'Руководитель правит любой объект');

set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
select is(pg_temp.rows_changed($$update public.sites set contact_name = 'Админ правит' where id = '51e00000-0000-0000-0000-000000000002'$$), 1, 'Администратор организации ведёт объекты, как и раньше');

set local request.jwt.claim.sub = '77000000-0000-0000-0000-000000000077';
select ok((select count(*) from public.sites) >= 3, 'Исполнитель читает объекты, как и раньше');
select is(pg_temp.rows_changed($$update public.sites set instructions = 'x'$$), 0, 'но не правит');

set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
select is((select count(*)::int from public.sites), 0, 'Администратор другой организации объектов не видит');
select is(pg_temp.rows_changed($$update public.sites set instructions = 'взлом'$$), 0, 'и не правит');

-- ------------------------------------------------------------
-- Обязательные документы
-- ------------------------------------------------------------
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select lives_ok(
  $$insert into public.site_required_documents (org_id, site_id, document_type_id)
    select private.default_org_id(), '51e00000-0000-0000-0000-000000000001', id from public.directories
    where org_id = private.default_org_id() and kind = 'document_type' and name = 'Медицинская книжка'$$,
  'Менеджер добавляет обязательный документ своему объекту'
);
select throws_ok(
  $$insert into public.site_required_documents (org_id, site_id, document_type_id)
    select private.default_org_id(), '51e00000-0000-0000-0000-000000000002', id from public.directories
    where org_id = private.default_org_id() and kind = 'document_type' and name = 'Паспорт'$$,
  '42501', null, 'Чужому объекту — нет'
);
select throws_ok(
  $$insert into public.site_required_documents (org_id, site_id, document_type_id)
    select private.default_org_id(), '51e00000-0000-0000-0000-000000000001', id from public.directories
    where org_id = private.default_org_id() and kind = 'holiday' limit 1$$,
  '22023', null, 'Запись не из типов документов отклоняется'
);
select throws_ok(
  $$insert into public.position_required_documents (org_id, position_id, document_type_id)
    select private.default_org_id(), p.id, d.id from public.positions p, public.directories d
    where p.name = 'Грузчик' and d.kind = 'document_type' and d.name = 'Паспорт' and d.org_id = private.default_org_id() limit 1$$,
  '42501', null, 'Документы позиций правит администратор, не менеджер объекта'
);
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
select lives_ok(
  $$insert into public.position_required_documents (org_id, position_id, document_type_id)
    select private.default_org_id(), p.id, d.id from public.positions p, public.directories d
    where p.org_id = private.default_org_id() and p.name = 'Грузчик' and d.kind = 'document_type' and d.name = 'Паспорт' and d.org_id = private.default_org_id()$$,
  'Администратор задаёт обязательные документы позиции'
);

-- Тариф на объект чужого заказчика
reset role;
select throws_ok(
  $$insert into public.tariffs (org_id, client_id, site_id, position_id, client_rate, worker_rate, valid_from)
    select private.default_org_id(), 'c2000000-0000-0000-0000-000000000002', '51e00000-0000-0000-0000-000000000001', p.id, 1, 1, current_date
    from public.positions p where p.org_id = private.default_org_id() limit 1$$,
  '22023', null, 'Тариф на объект другого заказчика отклоняется'
);

select * from finish();
rollback;
