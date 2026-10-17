-- Шаг 28: контроль документов.
-- Приёмка из ТЗ (раздел 18): исполнитель с истёкшей медкнижкой не назначается на склад с таким требованием.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('4e000000-0000-0000-0000-0000000000e1', 'rec@test.local'),
  ('ac000000-0000-0000-0000-0000000000ac', 'acc@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('5d000000-0000-0000-0000-0000000000d2', 'sm2@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 4) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'recruiter' where user_id = '4e000000-0000-0000-0000-0000000000e1';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'site_manager' where user_id in ('5c000000-0000-0000-0000-0000000000c1', '5d000000-0000-0000-0000-0000000000d2');
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('4e000000-0000-0000-0000-0000000000e1', 'Рекрутер', 'hiring'),
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта 1', 'sites'),
  ('5d000000-0000-0000-0000-0000000000d2', 'Менеджер объекта 2', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');
insert into public.clients (id, org_id, name, sales_manager_id, sites_manager_id, status) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active');
insert into public.sites (id, name, client_id, site_manager_id, status, latitude, longitude, checkin_method) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.7682, 55.097, 'geo'),
  ('51e00000-0000-0000-0000-000000000002', 'Склад 2', 'c1000000-0000-0000-0000-000000000001', '5d000000-0000-0000-0000-0000000000d2', 'active', 51.7682, 55.097, 'geo');
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 30, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
insert into public.site_required_documents (org_id, site_id, document_type_id)
  select private.default_org_id(), s.id, d.id from public.directories d, (values ('51e00000-0000-0000-0000-000000000001'::uuid), ('51e00000-0000-0000-0000-000000000002'::uuid)) s(id)
  where d.org_id = private.default_org_id() and d.kind = 'document_type' and d.name = 'Медицинская книжка';
update public.workers set tax_status = 'self_employed' where user_id in (select pg_temp.w(i) from generate_series(1, 4) i);
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from generate_series(1, 4) i, public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
-- W1 — книжка до +20, W2 — до +200 и договор до +20, W3 — книжка истекла, W4 — без книжки
insert into public.worker_documents (org_id, worker_id, document_type_id, status, valid_until, number_masked)
  select private.default_org_id(), pg_temp.w(v.i), d.id, 'verified', v.dt, '**' || v.i
  from (values (1, current_date + 20), (2, current_date + 200), (3, current_date - 3)) v(i, dt),
       public.directories d where d.org_id = private.default_org_id() and d.kind = 'document_type' and d.name = 'Медицинская книжка';
update public.workers set contract_valid_until = current_date + 20 where user_id = pg_temp.w(2);
update public.workers set contract_valid_until = current_date + 200 where user_id = pg_temp.w(1);

set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select o.id, private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', o.site, p.id, current_date + 10, current_date + 10, '08:00', '19:00', 3, 0, 60
  from public.positions p join (values ('a1000000-0000-0000-0000-000000000001'::uuid, '51e00000-0000-0000-0000-000000000001'::uuid)) o(id, site) on true
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order('a1000000-0000-0000-0000-000000000001');
-- Новые назначения: с истёкшей и отсутствующей книжкой нельзя
select is((select result from public.assign_workers((select array_agg(id) from public.shifts), array[pg_temp.w(3)])), 'rejected', 'Исполнитель с истёкшей медкнижкой не назначается');
select is((select result from public.assign_workers((select array_agg(id) from public.shifts), array[pg_temp.w(4)])), 'rejected', 'и без медкнижки тоже');
select is((select result from public.assign_workers((select array_agg(id) from public.shifts), array[pg_temp.w(1)])), 'assigned', 'С действующей книжкой на дату смены — можно');
select is((select result from public.assign_workers((select array_agg(id) from public.shifts), array[pg_temp.w(2)])), 'assigned', 'Договор и книжка действуют — можно');

-- Позднее срок документа и договора сокращается: назначения становятся недопустимыми
reset role;
update public.worker_documents set valid_until = current_date + 5 where worker_id = pg_temp.w(1);
update public.workers set contract_valid_until = current_date + 5 where user_id = pg_temp.w(2);

set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select is((select count(*)::int from public.document_conflicts(private.default_org_id(), current_date, current_date + 30)), 2, 'Две назначенные смены под угрозой');
select is((select problem from public.document_conflicts(private.default_org_id(), current_date, current_date + 30) where worker_id = pg_temp.w(1)), 'Нет действующего документа: Медицинская книжка', 'У первого истёк документ к дате смены');
select ok((select problem from public.document_conflicts(private.default_org_id(), current_date, current_date + 30) where worker_id = pg_temp.w(2)) like 'Договор с исполнителем истёк%', 'У второго истёк договор');
select is((select count(*)::int from public.document_conflicts(private.default_org_id(), current_date, current_date + 30) where shift_date = current_date + 10), 2, 'Видны с датой смены');
set local request.jwt.claim.sub = '5d000000-0000-0000-0000-0000000000d2';
select is((select count(*)::int from public.document_conflicts(private.default_org_id(), current_date, current_date + 30)), 0, 'Менеджер чужого объекта конфликтов не видит');
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select * from public.document_conflicts(private.default_org_id(), current_date, current_date + 30)$$, '42501', null, 'Продавцу список недоступен');

-- Реестр сроков
set local request.jwt.claim.sub = '4e000000-0000-0000-0000-0000000000e1';
select is((select count(*)::int from public.document_registry(private.default_org_id())), 5, 'В реестре: три книжки и два договора');
select is((select count(*)::int from public.document_registry(private.default_org_id(), null, 'expired')), 1, 'Просрочена одна книжка');
select is((select worker_id from public.document_registry(private.default_org_id(), null, 'expired')), pg_temp.w(3), 'у третьего исполнителя');
select is((select count(*)::int from public.document_registry(private.default_org_id(), null, 'd14')), 2, 'До 14 дней: книжка первого и договор второго');
select is((select count(*)::int from public.document_registry(private.default_org_id(), null, 'd3')), 0, 'До 3 дней — никого');
select is((select count(*)::int from public.document_registry(private.default_org_id(), (select id from public.directories where kind = 'document_type' and name = 'Медицинская книжка' and org_id = private.default_org_id()))), 3, 'Фильтр по типу документа');
select is((select count(*)::int from public.document_registry(private.default_org_id(), null, null, '51e00000-0000-0000-0000-000000000001')), 4, 'Фильтр по объекту: у назначенных на склад 1 два документа и два договора');
select is((select next_site from public.document_registry(private.default_org_id(), null, 'd14') where worker_id = pg_temp.w(1)), 'Склад 1', 'Показан ближайший объект исполнителя');
select is((select count(*)::int from public.document_registry(private.default_org_id(), null, null, null, 'w2')), 2, 'Поиск по имени находит книжку и договор исполнителя');

-- Напоминания
select is(public.remind_documents(private.default_org_id(), array[(select id from public.worker_documents where worker_id = pg_temp.w(1))], array[pg_temp.w(2)]), 2, 'Напоминание ушло по документу и по договору');
select is(public.remind_documents(private.default_org_id(), array[(select id from public.worker_documents where worker_id = pg_temp.w(1))], array[pg_temp.w(2)]), 0, 'Повтор в тот же день ничего не шлёт');
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select throws_ok($$select public.remind_documents(private.default_org_id(), array[gen_random_uuid()])$$, '42501', null, 'Бухгалтер напоминания не рассылает');
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select throws_ok($$select * from public.document_registry(private.default_org_id())$$, '42501', null, 'Менеджеру объекта реестр документов недоступен');

-- Ежедневное уведомление менеджеру объекта
reset role;
select private.notify_document_conflicts();
select private.notify_document_conflicts();
select is((select count(*)::int from public.notifications where user_id = '5c000000-0000-0000-0000-0000000000c1' and event = 'document_conflict'), 2, 'Менеджер объекта получил по уведомлению на каждый конфликт, без повторов');

select * from finish();
rollback;
