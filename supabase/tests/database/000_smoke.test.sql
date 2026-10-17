begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(3);

-- Проверяем, что раннер работает поверх миграций, а не пустой базы.
select has_function('public', 'has_role', array['uuid', 'app_role'],
  'Миграции создали серверную проверку роли');
select is(public.has_role('00000000-0000-0000-0000-000000000000'::uuid, 'admin'),
  false, 'Неизвестный пользователь не получает права администратора');
select ok((select relrowsecurity from pg_class where oid = 'public.user_roles'::regclass),
  'Для ролей включён RLS');

select * from finish();
rollback;
