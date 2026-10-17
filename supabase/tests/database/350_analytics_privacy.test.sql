-- Записи метрик с именами людей не отдаются ролям без доступа к исполнителям и всем кандидатам.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(7);

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('4e000000-0000-0000-0000-0000000000e1', 'rec@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local');
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'recruiter' where user_id = '4e000000-0000-0000-0000-0000000000e1';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('4e000000-0000-0000-0000-0000000000e1', 'Рекрутёр', 'hiring'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');
insert into public.candidates (org_id, full_name, phone, stage) values (private.default_org_id(), 'Чужой кандидат', '+79001112233', 'new');

set local role authenticated;
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select * from public.analytics_records(array[private.default_org_id()], 'active_base', current_date - 30, current_date)$$, '42501', null, 'Менеджер продаж не видит имена исполнителей в записях активной базы');
select throws_ok($$select * from public.rotation_calendar(private.default_org_id(), current_date, 7)$$, '42501', null, 'Календарь вахт с именами недоступен тому, кто не видит назначений');
set local request.jwt.claim.sub = '4e000000-0000-0000-0000-0000000000e1';
select throws_ok($$select * from public.analytics_records(array[private.default_org_id()], 'hire_conversion', current_date - 30, current_date)$$, '42501', null, 'Рекрутёр со своей областью не видит записи по всем кандидатам');
select ok((select count(*) from public.analytics_metrics(array[private.default_org_id()], current_date - 30, current_date) where metric = 'hire_conversion') = 1, 'но сама метрика ему доступна');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select is((select count(*)::int from public.analytics_records(array[private.default_org_id()], 'hire_conversion', current_date - 30, current_date)), 1, 'Руководитель видит записи');
select is((select label from public.analytics_records(array[private.default_org_id()], 'hire_conversion', current_date - 30, current_date)), 'Чужой кандидат', 'с именем кандидата');
select lives_ok($$select * from public.analytics_records(array[private.default_org_id()], 'staffing', current_date - 30, current_date)$$, 'Записи без имён людей доступны по-прежнему');

select * from finish();
rollback;
