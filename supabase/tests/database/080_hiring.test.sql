-- Шаг 8: кандидаты, документы, шифрование, допуск, задачи.
-- Приёмка из ТЗ (раздел 10): кандидат-иностранец без патента не может быть допущен;
-- после допуска есть задача про МВД со сроком.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(81);

create function pg_temp.rows_changed(_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute _sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.rows_changed(text) to authenticated;

create function pg_temp.dt(_code text) returns uuid language sql stable as $$
  select id from public.directories where org_id = private.default_org_id() and kind = 'document_type' and code = _code
$$;
grant execute on function pg_temp.dt(text) to authenticated;

-- R1 и R2 — рекрутеры, D — руководитель, S1 — продажи, AC — бухгалтер, A — администратор.
insert into auth.users (id, email) values
  ('71000000-0000-0000-0000-000000000001', 'r1@test.local'),
  ('72000000-0000-0000-0000-000000000002', 'r2@test.local'),
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('ac000000-0000-0000-0000-0000000000ac', 'ac@test.local'),
  ('a0000000-0000-0000-0000-00000000000a', 'a@test.local'),
  ('77000001-0000-0000-0000-000000000000', 'w1@test.local'),
  ('77000002-0000-0000-0000-000000000000', 'w2@test.local');
update public.user_roles set role = 'recruiter' where user_id in ('71000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000002');
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'admin' where user_id = 'a0000000-0000-0000-0000-00000000000a';
insert into public.staff_profiles (user_id, full_name, department) values
  ('71000000-0000-0000-0000-000000000001', 'Рекрутер 1', 'hiring'), ('72000000-0000-0000-0000-000000000002', 'Рекрутер 2', 'hiring'),
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'), ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales'),
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting');

-- Медицинская книжка обязательна для позиции «Грузчик».
insert into public.position_required_documents (org_id, position_id, document_type_id)
  select private.default_org_id(), p.id, pg_temp.dt('medical_book') from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';

insert into public.candidates (id, org_id, full_name, phone, citizenship, tax_status, recruiter_id) values
  ('ca100000-0000-0000-0000-000000000001', private.default_org_id(), 'Иван Кандидатов', '+7 900 111-22-33', 'Россия', 'self_employed', '71000000-0000-0000-0000-000000000001'),
  ('ca200000-0000-0000-0000-000000000002', private.default_org_id(), 'Мирзо Иностранцев', '+7 900 222-33-44', 'Узбекистан', 'self_employed', '71000000-0000-0000-0000-000000000001'),
  ('ca300000-0000-0000-0000-000000000003', private.default_org_id(), 'Чужой Кандидат', '+7 900 333-44-55', 'Россия', null, '72000000-0000-0000-0000-000000000002');
insert into public.candidate_positions (org_id, candidate_id, position_id)
  select private.default_org_id(), 'ca100000-0000-0000-0000-000000000001', p.id from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';

-- ------------------------------------------------------------
-- Вспомогательные правила
-- ------------------------------------------------------------
select is(private.is_foreign('Россия'), false, 'Россия — не иностранец');
select is(private.is_foreign(' РФ '), false, 'РФ — не иностранец');
select is(private.is_foreign('Узбекистан'), true, 'Узбекистан — иностранец');
select is(private.is_foreign(null), false, 'Без гражданства иностранцем не считаем (чек-лист потребует его указать)');
select is(private.add_working_days(date '2026-10-30', 3, private.default_org_id()), date '2026-11-05',
  'Три рабочих дня от пятницы: выходные и 4 ноября пропускаются');
select is((select count(*)::int from public.directories where kind = 'document_type' and code is not null and org_id = private.default_org_id()), 8,
  'У типов документов есть коды');

-- ------------------------------------------------------------
-- Шифрование
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into public.candidate_documents (id, org_id, candidate_id, document_type_id)
    values ('d0c00000-0000-0000-0000-000000000001', private.default_org_id(), 'ca100000-0000-0000-0000-000000000001', pg_temp.dt('passport'))$$,
  'Рекрутер заводит документ кандидата'
);
select throws_ok($$select public.set_document_number('candidate_documents', 'd0c00000-0000-0000-0000-000000000001', '4501 123456')$$,
  '55000', null, 'Без ключа шифрования номер сохранить нельзя');
reset role;
select set_config('app.pii_key', repeat('k', 40), true);
set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-0000-0000-000000000001';
select lives_ok($$select public.set_document_number('candidate_documents', 'd0c00000-0000-0000-0000-000000000001', '4501 123456')$$, 'С ключом номер сохраняется');
select is((select number_masked from public.candidate_documents where id = 'd0c00000-0000-0000-0000-000000000001'), '•••• 3456', 'В таблице только маска');
select ok((select number_encrypted is not null and position('4501' in encode(number_encrypted, 'escape')) = 0
           from public.candidate_documents where id = 'd0c00000-0000-0000-0000-000000000001'), 'Номер лежит зашифрованным');
select is(public.reveal_document_number('candidate_documents', 'd0c00000-0000-0000-0000-000000000001'), '4501 123456', 'Полный номер открывается по запросу');
reset role;
select ok(exists (select 1 from public.audit_log where action = 'view' and table_name = 'candidate_documents'
                  and record_id = 'd0c00000-0000-0000-0000-000000000001' and actor_id = '71000000-0000-0000-0000-000000000001'),
  'Просмотр полного номера записан в журнал доступа');
set local role authenticated;
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select public.reveal_document_number('candidate_documents', 'd0c00000-0000-0000-0000-000000000001')$$, '42501', null, 'Продажи номер открыть не могут');
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
select throws_ok($$select public.reveal_document_number('candidate_documents', 'd0c00000-0000-0000-0000-000000000001')$$, '42501', null, 'Администратор системы паспортные данные не видит');

-- Реквизиты выплаты, ИНН, СНИЛС
set local request.jwt.claim.sub = '71000000-0000-0000-0000-000000000001';
select lives_ok($$select public.set_person_secret('candidate', 'ca100000-0000-0000-0000-000000000001', 'payout', '40817810000000001234')$$, 'Рекрутер вносит реквизиты выплаты кандидата');
select is((select masked from public.person_secret_masks('candidate', 'ca100000-0000-0000-0000-000000000001') where field = 'payout'), '•••• 1234', 'Реквизиты видны только маской');
select is(public.reveal_person_secret('candidate', 'ca100000-0000-0000-0000-000000000001', 'payout'), '40817810000000001234', 'Открыть полностью можно с правом на реквизиты');
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select public.reveal_person_secret('candidate', 'ca100000-0000-0000-0000-000000000001', 'payout')$$, '42501', null, 'Продажи реквизиты не видят');
select throws_ok($$select * from public.person_secrets$$, '42501', null, 'К таблице секретов прямого доступа нет');
reset role;
select ok(exists (select 1 from public.audit_log where table_name = 'person_secrets' and field = 'payout' and action = 'view'), 'Открытие реквизитов записано в журнал');

-- ------------------------------------------------------------
-- Кандидаты: доступ
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.candidates), 2, 'Рекрутер видит только своих кандидатов');
select lives_ok($$insert into public.candidates (org_id, full_name, recruiter_id) values (private.default_org_id(), 'Новый', '71000000-0000-0000-0000-000000000001')$$, 'Рекрутер заводит кандидата на себя');
select throws_ok($$insert into public.candidates (org_id, full_name, recruiter_id) values (private.default_org_id(), 'На другого', '72000000-0000-0000-0000-000000000002')$$, '42501', null, 'Но не на другого рекрутера');
select throws_ok($$insert into public.candidates (org_id, full_name, recruiter_id, stage) values (private.default_org_id(), 'Сразу далеко', '71000000-0000-0000-0000-000000000001', 'documents')$$, '42501', null, 'Кандидат заводится на этапе «Новый»');
select lives_ok($$update public.candidates set stage = 'contacted' where id = 'ca100000-0000-0000-0000-000000000001'$$, 'Кандидат переходит на следующий этап');
select throws_ok($$update public.candidates set stage = 'rejected' where id = 'ca100000-0000-0000-0000-000000000001'$$, '23514', null, 'Отказ требует причину');
select lives_ok(
  $$update public.candidates set stage = 'rejected',
      reject_reason_id = (select id from public.directories where org_id = private.default_org_id() and kind = 'candidate_reject_reason' limit 1)
    where id = 'ca100000-0000-0000-0000-000000000001'$$,
  'Отказ с причиной из справочника'
);
select lives_ok($$update public.candidates set stage = 'documents', reject_reason_id = null where id = 'ca100000-0000-0000-0000-000000000001'$$, 'Кандидата можно вернуть в воронку');
select throws_ok($$update public.candidates set stage = 'admitted' where id = 'ca100000-0000-0000-0000-000000000001'$$, '42501', null, 'Вручную в «Допущен» не перевести: только допуском');
select lives_ok(
  $$insert into public.candidate_activities (org_id, candidate_id, kind, result, next_step, next_at)
    values (private.default_org_id(), 'ca100000-0000-0000-0000-000000000001', 'call', 'Договорились о встрече', 'Встреча в офисе', now() + interval '2 days')$$,
  'Касание записывается в историю'
);
select ok((select next_contact_note = 'Встреча в офисе' and next_contact_at > now() from public.candidates where id = 'ca100000-0000-0000-0000-000000000001'),
  'Следующий шаг касания стал следующим контактом кандидата');

set local request.jwt.claim.sub = '72000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.candidates), 1, 'Другой рекрутер видит только своего');
select is(pg_temp.rows_changed($$update public.candidates set city = 'взлом' where id = 'ca100000-0000-0000-0000-000000000001'$$), 0, 'и не правит чужого');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select is((select count(*)::int from public.candidates), 4, 'Руководитель видит всех кандидатов');
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.candidates), 0, 'Продажи кандидатов не видят');

-- Дубли и слияние
set local request.jwt.claim.sub = '71000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.find_duplicates(private.default_org_id(), '8 (900) 111-22-33')), 1, 'По телефону находится дубль независимо от написания');
reset role;
update public.workers set phone = '+7 (900) 111-22-33' where user_id = '77000001-0000-0000-0000-000000000000';
set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.find_duplicates(private.default_org_id(), '89001112233') where kind = 'worker'), 1, 'Дубль находится и среди исполнителей');
reset role;
insert into public.candidates (id, org_id, full_name, phone, recruiter_id)
  values ('ca400000-0000-0000-0000-000000000004', private.default_org_id(), 'Иван Кандидатов (дубль)', '89001112233', '71000000-0000-0000-0000-000000000001');
insert into public.candidate_activities (org_id, candidate_id, kind, result) values (private.default_org_id(), 'ca400000-0000-0000-0000-000000000004', 'note', 'Заметка дубля');
set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-0000-0000-000000000001';
select throws_ok($$select public.merge_candidates('ca100000-0000-0000-0000-000000000001', 'ca400000-0000-0000-0000-000000000004')$$, '42501', null, 'Слить карточки может тот, кто вправе удалять кандидатов');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select lives_ok($$select public.merge_candidates('ca100000-0000-0000-0000-000000000001', 'ca400000-0000-0000-0000-000000000004')$$, 'Руководитель сливает дубли');
select is((select count(*)::int from public.candidate_activities where candidate_id = 'ca100000-0000-0000-0000-000000000001' and result = 'Заметка дубля'), 1, 'История дубля перешла к оставленной карточке');
select is((select count(*)::int from public.candidates where id = 'ca400000-0000-0000-0000-000000000004'), 0, 'Дубль удалён');

-- ------------------------------------------------------------
-- Чек-лист и допуск
-- ------------------------------------------------------------
set local request.jwt.claim.sub = '71000000-0000-0000-0000-000000000001';
select ok(not exists (select 1 from public.candidate_checklist('ca100000-0000-0000-0000-000000000001') where code = 'patent_or_rvp'), 'Гражданину РФ патент не нужен');
select ok(exists (select 1 from public.candidate_checklist('ca200000-0000-0000-0000-000000000002') where code = 'patent_or_rvp'), 'Иностранцу нужен патент или РВП/ВНЖ');
select ok(exists (select 1 from public.candidate_checklist('ca100000-0000-0000-0000-000000000001') where code = 'medical_book'), 'Медкнижка требуется, если её требует желаемая позиция');
select ok(not exists (select 1 from public.candidate_checklist('ca200000-0000-0000-0000-000000000002') where code = 'medical_book'), 'А без таких позиций — нет');
select ok((select count(*) from public.check_admission('ca100000-0000-0000-0000-000000000001')) > 5, 'Пока документы не проверены, допуск закрыт');

reset role;
select throws_ok($$select private.complete_admission('ca100000-0000-0000-0000-000000000001', '77000001-0000-0000-0000-000000000000', '71000000-0000-0000-0000-000000000001')$$,
  '22023', null, 'Допуск с незакрытым чек-листом отклоняется базой');

-- Иностранец: всё есть, кроме патента или РВП
insert into public.candidate_documents (org_id, candidate_id, document_type_id, status, valid_until)
  select private.default_org_id(), 'ca200000-0000-0000-0000-000000000002', pg_temp.dt(c), 'verified', current_date + 365
  from unnest(array['passport', 'inn', 'snils', 'pd_consent', 'contract']) c;
insert into public.person_secrets (subject_type, subject_id, org_id, payout_encrypted, payout_masked)
  values ('candidate', 'ca200000-0000-0000-0000-000000000002', private.default_org_id(), private.pii_encrypt('40817810000000009999'), '•••• 9999');
select is((select string_agg(label, ';') from private.candidate_checklist('ca200000-0000-0000-0000-000000000002') where not done), 'Патент с оплаченным налогом или РВП/ВНЖ проверен',
  'У иностранца не хватает только патента или РВП');
select throws_ok($$select private.complete_admission('ca200000-0000-0000-0000-000000000002', '77000002-0000-0000-0000-000000000000', null)$$,
  '22023', null, 'Иностранец без патента допущен быть не может');
insert into public.candidate_documents (org_id, candidate_id, document_type_id, status, valid_until, paid_until)
  select private.default_org_id(), 'ca200000-0000-0000-0000-000000000002', pg_temp.dt('patent'), 'verified', current_date + 200, current_date - 1;
select is((select count(*)::int from private.candidate_checklist('ca200000-0000-0000-0000-000000000002') where not done), 1, 'Патент с неоплаченным налогом не считается');
update public.candidate_documents set paid_until = current_date + 20 where candidate_id = 'ca200000-0000-0000-0000-000000000002' and document_type_id = pg_temp.dt('patent');
select is((select count(*)::int from private.candidate_checklist('ca200000-0000-0000-0000-000000000002') where not done), 0, 'Патент с оплаченным налогом закрывает пункт');

-- Допуск иностранца
insert into auth.users (id, email, raw_user_meta_data) values ('77000003-0000-0000-0000-000000000000', 'w3@workers.local', '{"role":"worker","full_name":"Мирзо"}');
select is(private.complete_admission('ca200000-0000-0000-0000-000000000002', '77000003-0000-0000-0000-000000000000', '71000000-0000-0000-0000-000000000001'),
  '77000003-0000-0000-0000-000000000000'::uuid, 'Допуск создаёт исполнителя');
select ok((select status = 'active' and tax_status = 'self_employed' and citizenship = 'Узбекистан' and admitted_at is not null and full_name = 'Мирзо Иностранцев'
           from public.workers where user_id = '77000003-0000-0000-0000-000000000000'), 'Данные кандидата перенесены исполнителю');
select is((select count(*)::int from public.worker_documents where worker_id = '77000003-0000-0000-0000-000000000000'), 6, 'Проверенные документы перенесены');
select is((select count(*)::int from public.person_secrets where subject_type = 'worker' and subject_id = '77000003-0000-0000-0000-000000000000'), 1, 'Реквизиты перешли к исполнителю');
select is((select stage from public.candidates where id = 'ca200000-0000-0000-0000-000000000002'), 'admitted', 'Кандидат в статусе «Допущен»');
select is((select due_date from public.staff_tasks where kind = 'mvd_admission' and related_id = '77000003-0000-0000-0000-000000000000'),
  private.add_working_days(current_date, 3, private.default_org_id()), 'После допуска иностранца есть задача «Уведомить МВД» на 3 рабочих дня');
select throws_ok($$select private.complete_admission('ca200000-0000-0000-0000-000000000002', '77000003-0000-0000-0000-000000000000', null)$$, '22023', null, 'Повторный допуск отклоняется');

-- Допуск гражданина РФ: медкнижка нужна из-за позиции
insert into public.candidate_documents (org_id, candidate_id, document_type_id, status, valid_until)
  select private.default_org_id(), 'ca100000-0000-0000-0000-000000000001', pg_temp.dt(c), 'verified', current_date + 365
  from unnest(array['inn', 'snils', 'pd_consent', 'contract', 'medical_book']) c;
update public.candidate_documents set status = 'verified', valid_until = current_date + 365 where id = 'd0c00000-0000-0000-0000-000000000001';
select is((select count(*)::int from private.candidate_checklist('ca100000-0000-0000-0000-000000000001') where not done), 0, 'У гражданина РФ все пункты закрыты');
insert into auth.users (id, email, raw_user_meta_data) values ('77000004-0000-0000-0000-000000000000', 'w4@workers.local', '{"role":"worker"}');
select lives_ok($$select private.complete_admission('ca100000-0000-0000-0000-000000000001', '77000004-0000-0000-0000-000000000000', null)$$, 'Гражданин РФ допускается');
select is((select count(*)::int from public.staff_tasks where related_id = '77000004-0000-0000-0000-000000000000'), 0, 'Для гражданина РФ задачи про МВД нет');
select is((select count(*)::int from public.worker_positions where worker_id = '77000004-0000-0000-0000-000000000000'), 1, 'Желаемые позиции стали позициями исполнителя');
set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-0000-0000-000000000001';
select is(public.reveal_document_number('worker_documents', (select id from public.worker_documents where worker_id = '77000004-0000-0000-0000-000000000000' and number_encrypted is not null)), '4501 123456',
  'Зашифрованный номер документа переехал вместе с документом');
select is(pg_temp.rows_changed($$delete from public.candidate_documents where id = 'd0c00000-0000-0000-0000-000000000001'$$), 0, 'Проверенный документ кандидата не удаляется');

-- ------------------------------------------------------------
-- Сроки, задачи, списки
-- ------------------------------------------------------------
reset role;
update public.worker_documents set valid_until = current_date + 2 where worker_id = '77000004-0000-0000-0000-000000000000' and document_type_id = pg_temp.dt('medical_book');
update public.worker_documents set paid_until = current_date + 5 where worker_id = '77000003-0000-0000-0000-000000000000' and document_type_id = pg_temp.dt('patent');
select is(private.generate_document_tasks(), 4, 'Проверка сроков создаёт задачи: три по сроку документа (30, 14 и 3 дня) и одну по налогу патента');
select is(private.generate_document_tasks(), 0, 'Повторный запуск ничего не дублирует');
update public.workers set status = 'not_working' where user_id in ('77000003-0000-0000-0000-000000000000', '77000004-0000-0000-0000-000000000000');
select is((select count(*)::int from public.staff_tasks where kind = 'mvd_termination'), 1, 'Прекращение работы иностранца создаёт задачу «Уведомить МВД», у гражданина РФ — нет');

set local role authenticated;
set local request.jwt.claim.sub = '72000000-0000-0000-0000-000000000002';
select ok((select count(*) from public.staff_tasks) > 0, 'Рекрутер видит задачи своей роли');
select lives_ok($$update public.staff_tasks set done_at = now(), done_by = '72000000-0000-0000-0000-000000000002' where kind = 'mvd_termination'$$, 'и отмечает их выполненными');
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.staff_tasks), 0, 'Продажи задач найма не видят');

-- Списки активации и рефералы
reset role;
update public.workers set status = 'active', admitted_at = now() - interval '20 days' where user_id in ('77000001-0000-0000-0000-000000000000', '77000002-0000-0000-0000-000000000000');
update public.workers set referrer_id = '77000001-0000-0000-0000-000000000000' where user_id = '77000002-0000-0000-0000-000000000000';
set local role authenticated;
set local request.jwt.claim.sub = '71000000-0000-0000-0000-000000000001';
select ok((select count(*) from public.worker_activation_list(private.default_org_id(), 'no_shift_14') where worker_id = '77000001-0000-0000-0000-000000000000') = 1,
  'Допущенный, но не выходивший исполнитель попал в список обзвона');
select is((select qualifies from public.referral_report(private.default_org_id()) where referred_id = '77000002-0000-0000-0000-000000000000'), false, 'Приведённый без пяти смен бонуса не даёт');
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select * from public.worker_activation_list(private.default_org_id(), 'idle_30')$$, '42501', null, 'Списки активации — только найму и руководству');

-- ------------------------------------------------------------
-- Файлы документов
-- ------------------------------------------------------------
set local request.jwt.claim.sub = '71000000-0000-0000-0000-000000000001';
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner) values ('person-documents', private.default_org_id()::text || '/candidate/ca100000-0000-0000-0000-000000000001/passport.jpg', '71000000-0000-0000-0000-000000000001')$$,
  'Рекрутер загружает скан документа'
);
select is((select count(*)::int from storage.objects where bucket_id = 'person-documents'), 1, 'и читает его');
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values ('person-documents', 'не-uuid/candidate/x/file.jpg', '71000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'Путь не по схеме отклоняется'
);
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select is((select count(*)::int from storage.objects where bucket_id = 'person-documents'), 0, 'Продажи сканы документов не видят');
set local request.jwt.claim.sub = '77000001-0000-0000-0000-000000000000';
select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner) values ('person-documents', private.default_org_id()::text || '/worker/77000001-0000-0000-0000-000000000000/medbook.jpg', '77000001-0000-0000-0000-000000000000')$$,
  'Исполнитель загружает файл в свою папку'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner) values ('person-documents', private.default_org_id()::text || '/worker/77000002-0000-0000-0000-000000000000/medbook.jpg', '77000001-0000-0000-0000-000000000000')$$,
  '42501', null, 'но не в чужую'
);
select is((select count(*)::int from storage.objects where bucket_id = 'person-documents'), 1, 'Исполнитель видит только свои файлы');

select * from finish();
rollback;
