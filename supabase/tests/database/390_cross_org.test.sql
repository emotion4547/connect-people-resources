-- Изоляция организаций на объектах этапа 3: руководитель одной организации не видит и не меняет данные другой.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'da@test.local'),
  ('d2000000-0000-0000-0000-00000000000d', 'db@test.local');
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор А', 'management'),
  ('d2000000-0000-0000-0000-00000000000d', 'Директор Б', 'management');
-- Организация Б со своим директором и данными
insert into public.organizations (id, name) values ('0b000000-0000-0000-0000-00000000000b', 'Организация Б');
delete from public.user_roles where user_id = 'd2000000-0000-0000-0000-00000000000d';
insert into public.user_roles (user_id, role, org_id) values ('d2000000-0000-0000-0000-00000000000d', 'director', '0b000000-0000-0000-0000-00000000000b');
insert into public.clients (id, org_id, name, status) values ('cb000000-0000-0000-0000-00000000000b', '0b000000-0000-0000-0000-00000000000b', 'Заказчик Б', 'active');
insert into public.deals (id, org_id, title, owner_id) values ('db000000-0000-0000-0000-00000000000b', '0b000000-0000-0000-0000-00000000000b', 'Сделка Б', 'd2000000-0000-0000-0000-00000000000d');
insert into public.cashflow_entries (org_id, account_id, entry_date, direction, amount, source)
  select '0b000000-0000-0000-0000-00000000000b', id, current_date, 'out', 777, 'manual' from public.cash_accounts where org_id = '0b000000-0000-0000-0000-00000000000b' and kind = 'bank';
insert into public.bdr_plans (org_id, month, article, amount) values ('0b000000-0000-0000-0000-00000000000b', date_trunc('month', current_date)::date, 'revenue', 5000);

set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select is((select count(*)::int from public.deals), 0, 'Сделки чужой организации не видны');
select is((select count(*)::int from public.cashflow_entries where amount = 777), 0, 'Операции ДДС чужой организации не видны');
select is((select count(*)::int from public.bdr_plans), 0, 'План БДР чужой организации не виден');
select is((select count(*)::int from public.cash_accounts where org_id = '0b000000-0000-0000-0000-00000000000b'), 0, 'Счета чужой организации не видны');
select throws_ok($$select * from public.bdr_report(array['0b000000-0000-0000-0000-00000000000b'::uuid], current_date - 30, current_date)$$, '42501', null, 'БДР чужой организации недоступен');
select throws_ok($$select * from public.analytics_metrics(array['0b000000-0000-0000-0000-00000000000b'::uuid], current_date - 30, current_date)$$, '42501', null, 'Метрики чужой организации недоступны');
select throws_ok($$select * from public.payment_calendar('0b000000-0000-0000-0000-00000000000b', current_date, 7)$$, '42501', null, 'Календарь чужой организации недоступен');
select throws_ok($$select * from public.document_registry('0b000000-0000-0000-0000-00000000000b')$$, '42501', null, 'Реестр документов чужой организации недоступен');
select throws_ok($$select * from public.deal_funnel('0b000000-0000-0000-0000-00000000000b')$$, '42501', null, 'Воронка чужой организации недоступна');
select throws_ok($$select public.save_bdr_plan('0b000000-0000-0000-0000-00000000000b', current_date, 'revenue', 1)$$, '42501', null, 'План чужой организации не правится');
select throws_ok($$select public.save_cash_account('0b000000-0000-0000-0000-00000000000b', null, 'cash', 'Чужая касса', null, null, 0, current_date)$$, '42501', null, 'Счёт в чужой организации не заводится');
select throws_ok($$select public.import_rows('0b000000-0000-0000-0000-00000000000b', 'clients', '[{"name":"X"}]'::jsonb, true)$$, '42501', null, 'Импорт в чужую организацию невозможен');
select throws_ok($$select public.win_deal('db000000-0000-0000-0000-00000000000b')$$, '42501', null, 'Чужую сделку выиграть нельзя');
select throws_ok($$select public.set_deal_stage('db000000-0000-0000-0000-00000000000b', 'qualification')$$, '42501', null, 'и перенести на другой этап');
select throws_ok($$select public.remind_documents('0b000000-0000-0000-0000-00000000000b', array[gen_random_uuid()])$$, '42501', null, 'Напоминания в чужой организации не рассылаются');
-- Смешанный список организаций: чужая молча отбрасывается, своя считается
select ok((select count(*) from public.analytics_metrics(array[private.default_org_id(), '0b000000-0000-0000-0000-00000000000b'::uuid], current_date - 30, current_date)) > 0, 'В смешанном списке работает только своя организация');

select * from finish();
rollback;
