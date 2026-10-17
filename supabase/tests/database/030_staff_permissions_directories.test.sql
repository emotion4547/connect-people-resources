-- Шаг 3: роли отделов, матрица прав, блокировка сотрудника, справочники.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(51);

create function pg_temp.rows_changed(_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute _sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.rows_changed(text) to authenticated;

-- Организация 1 (по умолчанию): A — администратор, C — hr (не сотрудник отделов),
-- S — менеджер по продажам, X — продажи и бухгалтерия одновременно. Организация 2: B — администратор.
insert into public.organizations (id, name) values ('b2000000-0000-0000-0000-000000000002', 'Вторая организация');
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'a@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'b@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'c@test.local'),
  ('5a000000-0000-0000-0000-000000000005', 's@test.local'),
  ('5b000000-0000-0000-0000-00000000000b', 'x@test.local');
update public.user_roles set role = 'admin' where user_id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');
update public.user_roles set role = 'hr' where user_id = 'c0000000-0000-0000-0000-00000000000c';
update public.user_roles set role = 'sales' where user_id in ('5a000000-0000-0000-0000-000000000005', '5b000000-0000-0000-0000-00000000000b');
update public.user_roles set org_id = 'b2000000-0000-0000-0000-000000000002' where user_id = 'b0000000-0000-0000-0000-00000000000b';
insert into public.user_roles (user_id, role) values ('5b000000-0000-0000-0000-00000000000b', 'accountant');
insert into public.staff_profiles (user_id, full_name, department) values
  ('5a000000-0000-0000-0000-000000000005', 'Сергей Продажин', 'sales'),
  ('5b000000-0000-0000-0000-00000000000b', 'Ксения Бухгалтер', 'accounting');
insert into auth.sessions (user_id) values ('5a000000-0000-0000-0000-000000000005');

-- ------------------------------------------------------------
-- Роли и матрица прав по умолчанию
-- ------------------------------------------------------------
select is(
  (select count(*)::int from pg_enum where enumtypid = 'public.app_role'::regtype
    and enumlabel in ('director', 'sales', 'site_manager', 'recruiter', 'accountant', 'client_admin', 'client_manager')),
  7, 'Роли отделов из ТЗ добавлены'
);
select is((select count(*)::int from public.role_permissions where org_id = private.default_org_id()), 510,
  'Матрица: 6 ролей × 17 модулей × 5 действий');
select is((select scope from public.role_permissions where org_id = private.default_org_id() and role = 'director' and module = 'clients' and action = 'view'), 'all', 'Руководитель видит всех заказчиков');
select is((select scope from public.role_permissions where org_id = private.default_org_id() and role = 'sales' and module = 'clients' and action = 'view'), 'own', 'Продажи видят только своих заказчиков');
select is((select scope from public.role_permissions where org_id = private.default_org_id() and role = 'sales' and module = 'clients' and action = 'delete'), 'none', 'Продажи не удаляют заказчиков');
select is((select scope from public.role_permissions where org_id = private.default_org_id() and role = 'accountant' and module = 'payout_registries' and action = 'update'), 'all', 'Бухгалтер ведёт реестры выплат');
select is((select scope from public.role_permissions where org_id = private.default_org_id() and role = 'site_manager' and module = 'worker_documents' and action = 'view'), 'none', 'Менеджер объекта не видит документы исполнителей');
select is((select scope from public.role_permissions where org_id = private.default_org_id() and role = 'sales' and module = 'accruals' and action = 'view'), 'own', 'Продажи видят свои начисления');
select is((select scope from public.role_permissions where org_id = private.default_org_id() and role = 'sales' and module = 'accruals' and action = 'update'), 'none', 'Но не правят их');
select is((select scope from public.role_permissions where org_id = private.default_org_id() and role = 'recruiter' and module = 'candidates' and action = 'create'), 'own', 'Рекрутер заводит кандидатов');
select is((select scope from public.role_permissions where org_id = private.default_org_id() and role = 'admin' and module = 'cashflow' and action = 'view'), 'none', 'Администратор системы не видит деньги');
select is((select scope from public.role_permissions where org_id = private.default_org_id() and role = 'director' and module = 'analytics' and action = 'view'), 'all', 'Аналитика руководителя — вся');
select is((select scope from public.role_permissions where org_id = private.default_org_id() and role = 'sales' and module = 'analytics' and action = 'view'), 'department', 'Аналитика продаж — свой отдел');

select is(private.permission_scope('5a000000-0000-0000-0000-000000000005', private.default_org_id(), 'clients', 'view'), 'own',
  'Область продавца — свои');
select is(private.permission_scope('5b000000-0000-0000-0000-00000000000b', private.default_org_id(), 'clients', 'view'), 'all',
  'При двух ролях действует наибольшая область');
select is(private.permission_scope('c0000000-0000-0000-0000-00000000000c', private.default_org_id(), 'clients', 'view'), 'none',
  'Без роли отдела доступа нет');

-- ------------------------------------------------------------
-- Администратор организации 1 правит права
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';

select is(pg_temp.rows_changed($$update public.role_permissions set scope = 'all' where role = 'sales' and module = 'clients' and action = 'delete'$$), 1,
  'Администратор меняет область права');
select ok(
  exists (select 1 from public.audit_log where table_name = 'role_permissions' and record_id = 'sales/clients/delete'
          and field = 'scope' and old_value = 'none' and new_value = 'all'),
  'Изменение права записано в журнал с понятным идентификатором');
select throws_ok($$insert into public.role_permissions (org_id, role, module, action) values (private.default_org_id(), 'sales', 'new_module', 'view')$$,
  '42501', null, 'Новые строки в сетку добавлять нельзя');
select throws_ok($$delete from public.role_permissions$$, '42501', null, 'Строки сетки удалять нельзя');
select throws_ok($$update public.role_permissions set role = 'director'$$, '42501', null, 'Кроме области, в сетке ничего менять нельзя');

-- ------------------------------------------------------------
-- Сотрудники: правка, блокировка
-- ------------------------------------------------------------
select lives_ok(
  $$select public.update_staff_profile('5a000000-0000-0000-0000-000000000005', 'Сергей Продажин-Старший', 'sales', 'Старший менеджер', '+79000000000', true)$$,
  'Администратор правит профиль сотрудника'
);
select is((select full_name from public.staff_profiles where user_id = '5a000000-0000-0000-0000-000000000005'), 'Сергей Продажин-Старший',
  'Правка сохранилась');
select throws_ok($$select public.block_staff('a0000000-0000-0000-0000-00000000000a', 'тест')$$, '22023', null, 'Себя заблокировать нельзя');
select throws_ok($$select public.block_staff('5a000000-0000-0000-0000-000000000005', '  ')$$, '22023', null, 'Блокировка требует причину');
select lives_ok($$select public.block_staff('5a000000-0000-0000-0000-000000000005', 'уволен')$$, 'Администратор блокирует сотрудника');
select throws_ok($$select public.block_staff('5a000000-0000-0000-0000-000000000005', 'ещё раз')$$, 'P0002', null, 'Повторная блокировка отклоняется');

reset role;
select is(private.has_org_role('5a000000-0000-0000-0000-000000000005', 'sales', private.default_org_id()), false,
  'Заблокированный теряет роль в организации сразу');
select is(private.permission_scope('5a000000-0000-0000-0000-000000000005', private.default_org_id(), 'clients', 'view'), 'none',
  'И область прав обнуляется');
select ok((select banned_until is not null from auth.users where id = '5a000000-0000-0000-0000-000000000005'), 'Вход закрыт');
select is((select count(*)::int from auth.sessions where user_id = '5a000000-0000-0000-0000-000000000005'), 0, 'Открытые сессии закрыты');
select ok(
  exists (select 1 from public.audit_log where table_name = 'staff_profiles' and field = 'block' and note = 'уволен'
          and org_id = private.default_org_id() and actor_id = 'a0000000-0000-0000-0000-00000000000a'),
  'Причина блокировки записана в журнал организации'
);

set local role authenticated;
set local request.jwt.claim.sub = '5a000000-0000-0000-0000-000000000005';
select is((select count(*)::int from public.organizations), 0, 'Заблокированный не видит организацию, даже с живым токеном');

set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
select throws_ok($$select public.update_staff_profile('5b000000-0000-0000-0000-00000000000b', 'Взлом', 'sales')$$, '42501', null,
  'Администратор другой организации не правит чужого сотрудника');
select is((select count(*)::int from public.role_permissions where org_id = private.default_org_id()), 0, 'И не видит чужие права');

set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select throws_ok($$select public.block_staff('5b000000-0000-0000-0000-00000000000b', 'x')$$, '42501', null, 'Не администратор не блокирует');
select is(pg_temp.rows_changed($$update public.role_permissions set scope = 'all'$$), 0, 'Не администратор не меняет права');

set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
select lives_ok($$select public.unblock_staff('5a000000-0000-0000-0000-000000000005')$$, 'Администратор снимает блокировку');
set local request.jwt.claim.sub = '5a000000-0000-0000-0000-000000000005';
select is((select count(*)::int from public.organizations), 1, 'Разблокированный снова видит организацию');
select is((select scope from public.my_permissions(private.default_org_id()) where module = 'clients' and action = 'view'), 'own',
  'my_permissions отдаёт права текущего пользователя');

-- ------------------------------------------------------------
-- Справочники
-- ------------------------------------------------------------
reset role;
select is((select count(*)::int from public.directories where org_id = private.default_org_id() and kind = 'candidate_source'), 5,
  'Источники кандидатов из ТЗ заведены');
select is((select count(*)::int from public.directories where org_id = private.default_org_id() and kind = 'holiday'), 28,
  'Праздничные дни 2026–2027 заведены');

set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
select lives_ok($$insert into public.directories (org_id, kind, name) values (private.default_org_id(), 'worker_group', 'Бригада грузчиков')$$,
  'Администратор добавляет запись справочника');
select throws_ok($$insert into public.directories (org_id, kind, name) values (private.default_org_id(), 'worker_group', 'Бригада грузчиков')$$,
  '23505', null, 'Дубль отклоняется');
select throws_ok($$insert into public.directories (org_id, kind, name) values (private.default_org_id(), 'holiday', 'Без даты')$$,
  '23514', null, 'Праздник без даты отклоняется');
select throws_ok($$delete from public.directories$$, '42501', null, 'Записи справочника не удаляются');
select is(pg_temp.rows_changed($$update public.directories set is_active = false where name = 'Бригада грузчиков'$$), 1,
  'Вместо удаления запись скрывают');

set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select throws_ok($$insert into public.directories (org_id, kind, name) values (private.default_org_id(), 'worker_group', 'Левая')$$,
  '42501', null, 'Не администратор справочники не правит');
select ok((select count(*) from public.directories) > 0, 'Но читает их');

set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
select is((select count(*)::int from public.directories where org_id = private.default_org_id()), 0, 'Справочники чужой организации не видны');

-- Новая организация получает права и справочники сразу
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
select public.create_organization('Организация для проверки заготовок');
select is(
  (select count(*)::int from public.role_permissions rp join public.organizations o on o.id = rp.org_id where o.name = 'Организация для проверки заготовок'),
  510, 'Новая организация получает матрицу прав'
);

select * from finish();
rollback;
