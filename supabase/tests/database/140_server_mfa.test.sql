begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

insert into auth.users (id, email) values
  ('d1400000-0000-0000-0000-000000000001', 'mfa-director@test.local');
update public.user_roles set role = 'director' where user_id = 'd1400000-0000-0000-0000-000000000001';
insert into public.staff_profiles (user_id, full_name, department)
values ('d1400000-0000-0000-0000-000000000001', 'Тест MFA', 'management');
insert into public.candidates (id, org_id, full_name, recruiter_id)
values ('ca140000-0000-0000-0000-000000000001', private.default_org_id(), 'Тестовый кандидат', 'd1400000-0000-0000-0000-000000000001');
insert into public.candidate_documents (id, org_id, candidate_id, document_type_id)
select 'dc140000-0000-0000-0000-000000000001', private.default_org_id(), 'ca140000-0000-0000-0000-000000000001', id
from public.directories where org_id = private.default_org_id() and kind = 'document_type' and code = 'passport';

set local role authenticated;
set local request.jwt.claim.sub = 'd1400000-0000-0000-0000-000000000001';
set local request.jwt.claims = '{"sub":"d1400000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1"}';
select is(public.session_mfa_ok(private.default_org_id()), true, 'При выключенном требовании достаточно пароля');
reset role;
insert into public.org_settings (org_id, key, value)
values (private.default_org_id(), 'auth.mfa_enforced', 'true');
set local role authenticated;

select is(public.session_mfa_ok(private.default_org_id()), false, 'При включённом MFA пароль недостаточен');
select is(private.permission_scope(auth.uid(), private.default_org_id(), 'accruals', 'view'), 'none', 'Финансовые права закрыты при aal1');
select is(private.has_org_role(auth.uid(), 'director', private.default_org_id()), false, 'Проверка роли в RPC тоже требует MFA');
select is((select count(*)::int from public.candidate_documents), 0, 'Прямое чтение документов через RLS закрыто');
select throws_ok($$select public.reveal_document_number('candidate_documents', 'dc140000-0000-0000-0000-000000000001')$$,
  '42501', null, 'RPC раскрытия документа закрыта при aal1');

set local request.jwt.claims = '{"sub":"d1400000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}';
select is(public.session_mfa_ok(private.default_org_id()), true, 'Подтверждённая сессия проходит');
select isnt(private.permission_scope(auth.uid(), private.default_org_id(), 'accruals', 'view'), 'none', 'Финансовые права возвращаются после MFA');
select is(private.has_org_role(auth.uid(), 'director', private.default_org_id()), true, 'Роль руководителя доступна после MFA');
select is((select count(*)::int from public.candidate_documents), 1, 'Документы доступны после MFA');
select lives_ok($$select public.reveal_document_number('candidate_documents', 'dc140000-0000-0000-0000-000000000001')$$,
  'RPC работает после MFA');

set local request.jwt.claims = '{"sub":"d1400000-0000-0000-0000-000000000001","role":"authenticated"}';
select is(public.session_mfa_ok(private.default_org_id()), false, 'Отсутствующий aal не обходит MFA');
select is(public.session_mfa_ok('00000000-0000-0000-0000-000000000099'), false, 'MFA не даёт доступ к чужой организации');
set local role anon;
select throws_ok($$select public.session_mfa_ok(private.default_org_id())$$, '42501', null, 'Аноним не вызывает проверку сессии');
reset role;
select * from finish();
rollback;
