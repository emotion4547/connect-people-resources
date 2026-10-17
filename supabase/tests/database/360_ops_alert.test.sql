-- Служебные оповещения о сбоях сервера: администратору и руководителю, один раз в сутки на вид сбоя.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('ad000000-0000-0000-0000-0000000000ad', 'adm@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local');
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'admin' where user_id = 'ad000000-0000-0000-0000-0000000000ad';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('ad000000-0000-0000-0000-0000000000ad', 'Админ', 'admin'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');

select is(private.ops_alert('backup', 'Бэкап устарел', 'Последнему дампу 40 ч'), 2, 'Оповещены администратор и руководитель');
select is(private.ops_alert('backup', 'Бэкап устарел', 'Последнему дампу 41 ч'), 0, 'Повтор в тот же день не дублируется');
select is(private.ops_alert('disk', 'Мало места', '90%'), 2, 'Другой вид сбоя оповещает снова');
select is((select count(*)::int from public.notifications where user_id = '51000000-0000-0000-0000-000000000001' and event = 'ops_alert'), 0, 'Менеджер продаж служебных оповещений не получает');

select * from finish();
rollback;
