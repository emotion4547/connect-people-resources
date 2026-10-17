-- Журнал ошибок интерфейса: пишет вошедший пользователь, читают администратор и руководитель.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local');
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';

set local role authenticated;
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select lives_ok($$select public.log_client_error('TypeError: x is undefined', 'at Foo (bar.js:1)', '/deals/1', 'Chrome')$$, 'Пользователь сообщает об ошибке');
select public.log_client_error('TypeError: x is undefined', null, '/deals/1', 'Chrome');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select is((select count(*)::int from public.client_errors), 1, 'Тот же текст в течение минуты не дублируется');
select is((select role from public.client_errors), 'sales', 'В записи видна роль пользователя');
select is((select url from public.client_errors), '/deals/1', 'и страница');
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.client_errors), 0, 'Менеджер продаж журнал не читает');
reset role;
set local role anon;
select throws_ok($$select public.log_client_error('anon error')$$, '42501', null, 'Аноним функцию вызвать не может');
reset role;
select is((select count(*)::int from public.client_errors), 1, 'Записей от анонима нет');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
set local role authenticated;
select lives_ok($$select public.log_client_error(repeat('я', 2000), repeat('x', 9000))$$, 'Длинные тексты обрезаются, а не отвергаются');

select * from finish();
rollback;
