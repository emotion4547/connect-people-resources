-- Шаг 1: организации, роли по организациям, журнал изменений.
-- Приёмка из ТЗ (раздел 6): сотрудник одной организации не видит ни одной записи другой.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(30);

-- Число строк, затронутых запросом, посчитанное от имени текущей роли (RLS действует).
create function pg_temp.rows_changed(_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute _sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.rows_changed(text) to authenticated, anon;

-- ------------------------------------------------------------
-- Данные (под суперпользователем). Пользователь A — администратор организации 1,
-- B — администратор организации 2, C — hr организации 1, D — исполнитель организации 2.
-- ------------------------------------------------------------
insert into public.organizations (id, name) values ('b2000000-0000-0000-0000-000000000002', 'Вторая организация');

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'a@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'b@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'c@test.local'),
  ('d0000000-0000-0000-0000-00000000000d', 'd@test.local');

-- Регистрация сама выдала всем роль worker в организации по умолчанию (проверка ниже).
select is(
  (select count(*)::int from public.user_roles
    where role = 'worker' and org_id = private.default_org_id()
      and user_id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b',
                      'c0000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-00000000000d')),
  4, 'Регистрация выдаёт роль в организации по умолчанию'
);

select col_not_null('public', 'user_roles', 'org_id', 'У роли всегда есть организация');
select has_table('public', 'audit_log', 'Журнал изменений существует');

update public.user_roles set role = 'admin' where user_id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');
update public.user_roles set role = 'hr' where user_id = 'c0000000-0000-0000-0000-00000000000c';
update public.user_roles set org_id = 'b2000000-0000-0000-0000-000000000002'
  where user_id in ('b0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-00000000000d');

-- ------------------------------------------------------------
-- Администратор организации 1
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';

select is((select count(*)::int from public.organizations), 1, 'A видит только свою организацию');
select is((select count(*)::int from public.organizations where id = 'b2000000-0000-0000-0000-000000000002'), 0,
  'A не видит организацию 2');
select is(
  pg_temp.rows_changed($$update public.organizations set name = 'взлом' where id = 'b2000000-0000-0000-0000-000000000002'$$),
  0, 'A не может править чужую организацию'
);
select is(
  pg_temp.rows_changed($$update public.organizations set name = 'Новое имя' where id = private.default_org_id()$$),
  1, 'A правит свою организацию'
);
select is(
  (select count(*)::int from public.audit_log
    where table_name = 'organizations' and field = 'name' and old_value = 'Основная организация'
      and new_value = 'Новое имя' and actor_id = 'a0000000-0000-0000-0000-00000000000a'),
  1, 'Правка организации записана в журнал: поле, было, стало, автор'
);
select is((select count(*)::int from public.user_roles where org_id = 'b2000000-0000-0000-0000-000000000002'), 0,
  'A не видит роли чужой организации');
select throws_ok(
  $$insert into public.user_roles (user_id, role, org_id)
    values ('a0000000-0000-0000-0000-00000000000a', 'admin', 'b2000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'A не может выдать себе роль в чужой организации'
);
select lives_ok(
  $$insert into public.user_roles (user_id, role) values ('c0000000-0000-0000-0000-00000000000c', 'worker')$$,
  'A выдаёт роль в своей организации'
);
select is(
  (select count(*)::int from public.audit_log
    where table_name = 'user_roles' and action = 'insert' and actor_id = 'a0000000-0000-0000-0000-00000000000a'),
  1, 'Выдача роли записана в журнал'
);
select throws_ok($$update public.audit_log set note = 'x'$$, '42501', null, 'Клиент не может менять журнал');
select throws_ok($$delete from public.audit_log$$, '42501', null, 'Клиент не может удалять из журнала');

select lives_ok($$select public.create_organization('Новая организация')$$, 'Администратор создаёт организацию');
select is(
  (select count(*)::int from public.user_roles
    where user_id = 'a0000000-0000-0000-0000-00000000000a' and role = 'admin'
      and org_id in (select id from public.organizations where name = 'Новая организация')),
  1, 'Создатель становится администратором новой организации'
);
select lives_ok(
  $$select public.write_audit(private.default_org_id(), 'view', 'worker_documents', '42', 'открыт полный номер')$$,
  'Просмотр записывается в журнал'
);
select is((select count(*)::int from public.audit_log where action = 'view' and actor_id = 'a0000000-0000-0000-0000-00000000000a'), 1,
  'Запись о просмотре в журнале, автор — вызвавший');

-- ------------------------------------------------------------
-- Даже владелец базы не может изменить журнал
-- ------------------------------------------------------------
reset role;
select throws_ok($$update public.audit_log set note = 'x'$$, '42501', 'Журнал изменений нельзя менять или удалять',
  'Триггер запрещает UPDATE и владельцу');
select throws_ok($$delete from public.audit_log$$, '42501', 'Журнал изменений нельзя менять или удалять',
  'Триггер запрещает DELETE и владельцу');
select throws_ok($$truncate public.audit_log$$, '42501', 'Журнал изменений нельзя менять или удалять',
  'Триггер запрещает TRUNCATE');

-- ------------------------------------------------------------
-- Администратор организации 2
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';

select is((select count(*)::int from public.organizations), 1, 'B видит только свою организацию');
select is((select count(*)::int from public.audit_log where org_id = private.default_org_id()), 0,
  'B не видит журнал чужой организации');

-- ------------------------------------------------------------
-- hr организации 1: не администратор
-- ------------------------------------------------------------
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';

select is((select count(*)::int from public.organizations), 1, 'Участник организации видит её');
select is(
  pg_temp.rows_changed($$update public.organizations set name = 'hr был тут'$$),
  0, 'Не администратор не может править организацию'
);
select is((select count(*)::int from public.audit_log), 0, 'Не администратор не видит журнал');
select throws_ok($$select public.create_organization('Левая')$$, '42501', null, 'Не администратор не создаёт организации');
select throws_ok(
  $$select public.write_audit('b2000000-0000-0000-0000-000000000002', 'view', 'x', '1')$$,
  '42501', null, 'Нельзя писать в журнал чужой организации'
);
select throws_ok(
  $$select public.write_audit(private.default_org_id(), 'update', 'x', '1')$$,
  '22023', null, 'Из приложения в журнал пишутся только просмотры'
);

-- ------------------------------------------------------------
-- Аноним
-- ------------------------------------------------------------
reset role;
set local role anon;
select throws_ok($$select count(*) from public.organizations$$, '42501', null, 'Аноним не читает организации');

select * from finish();
rollback;
