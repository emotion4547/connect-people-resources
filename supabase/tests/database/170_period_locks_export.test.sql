-- Шаг 16: закрытие месяца и выгрузка в 1С.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(31);

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

create temp table mm as select date_trunc('month', current_date - interval '1 month')::date as m;
grant select on mm to authenticated;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('ac000000-0000-0000-0000-0000000000ac', 'acc@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'cu@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 2) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'site_manager' where user_id = '5c000000-0000-0000-0000-0000000000c1';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
update public.user_roles set role = 'client_admin' where user_id = 'c0000000-0000-0000-0000-00000000000c';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');

insert into public.clients (id, org_id, name, inn, legal_name, sales_manager_id, sites_manager_id, status) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '5612345678', 'ООО Заказчик 1', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active');
insert into public.client_contacts (org_id, client_id, full_name, user_id, cabinet_role)
  values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Кабинет 1', 'c0000000-0000-0000-0000-00000000000c', 'client_admin');
insert into public.contracts (id, org_id, client_id, number, signed_on, billing_period, payment_delay_days, status)
  values ('c0170000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Д-1', current_date - 400, 'month', 10, 'active');
insert into public.sites (id, name, client_id, site_manager_id, status, latitude, longitude, checkin_method) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.7682, 55.097, 'geo');
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 400, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
update public.workers set tax_status = 'self_employed' where user_id in (select pg_temp.w(i) from generate_series(1, 2) i);
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from generate_series(1, 2) i, public.positions p
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';

set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select 'a1000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
         current_date + 2, current_date + 2, '08:00', '19:00', 2, 0, 60
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order('a1000000-0000-0000-0000-000000000001');
select public.assign_workers((select array_agg(id) from public.shifts), array[pg_temp.w(1), pg_temp.w(2)]);
reset role;
-- Смена прошла в середине прошлого месяца, люди отработали по 10 часов
update public.shifts set shift_date = (select m + 14 from mm), start_at = ((select m + 14 from mm) + time '08:00') at time zone 'UTC',
       end_at = ((select m + 14 from mm) + time '19:00') at time zone 'UTC';
update public.assignments a set shift_start = s.start_at, shift_end = s.end_at, status = 'worked', planned_hours = 10, approved_hours = 10 from public.shifts s where s.id = a.shift_id;

-- ------------------------------------------------------------
-- Что мешает закрытию
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select cnt from public.month_close_blockers(private.default_org_id(), (select m from mm)) where code = 'no_timesheet'), 2, 'Мешает: отработанные смены не вошли в табель');
select throws_ok($$select public.close_month(private.default_org_id(), (select m from mm))$$, '22023', null, 'Закрыть с незавершёнными делами нельзя');

set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
create temp table ts as select public.build_timesheet('51e00000-0000-0000-0000-000000000001', (select m from mm), (select m + 27 from mm)) as id;
grant select on ts to authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select cnt from public.month_close_blockers(private.default_org_id(), (select m from mm)) where code = 'timesheets_open'), 1, 'Теперь мешает черновик табеля');
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select public.send_timesheet((select id from ts));
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select public.confirm_timesheet((select id from ts));
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select cnt from public.month_close_blockers(private.default_org_id(), (select m from mm)) where code = 'not_invoiced'), 2, 'Табель подтверждён: мешает, что начисления не выставлены');

create temp table act as select public.generate_client_documents('c1000000-0000-0000-0000-000000000001', (select m from mm), (select m + 27 from mm)) as id;
grant select on act to authenticated;
select is((select cnt from public.month_close_blockers(private.default_org_id(), (select m from mm)) where code = 'drafts'), 1, 'Теперь мешает черновик акта');
select public.issue_client_documents((select id from act));
select is((select count(*)::int from public.month_close_blockers(private.default_org_id(), (select m from mm)) where severity = 'block'), 0, 'Всё выставлено: блокирующих причин нет');

set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select * from public.month_close_blockers(private.default_org_id(), (select m from mm))$$, '42501', null, 'Продавцу причины закрытия не показываются');
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select throws_ok($$select public.close_month(private.default_org_id(), date_trunc('month', current_date)::date)$$, '22023', null, 'Текущий месяц закрыть нельзя');

-- ------------------------------------------------------------
-- Закрытие и защита закрытого месяца
-- ------------------------------------------------------------
select lives_ok($$select public.close_month(private.default_org_id(), (select m from mm))$$, 'Бухгалтер закрывает месяц');
select is((select is_closed from public.period_locks where month = (select m from mm)), true, 'Месяц помечен закрытым');
select throws_ok($$select public.close_month(private.default_org_id(), (select m from mm))$$, '22023', null, 'Второй раз закрыть нельзя');

set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select throws_ok($$select public.add_adjustment((select id from public.assignments limit 1), 'bonus', 100, (select id from public.directories where kind = 'bonus_reason' limit 1))$$,
                 '22023', 'Месяц закрыт: оформите корректировку в текущем периоде', 'Бонус в закрытый месяц не добавить');
reset role;
set local app.timesheet_internal = 'on';
select throws_ok($$update public.assignments set approved_hours = 1$$, '22023', 'Месяц закрыт: часы и отметки этой смены не меняются', 'Часы напрямую тоже не правятся');
select throws_ok($$insert into public.timesheets (org_id, site_id, client_id, period_from, period_to)
  values (private.default_org_id(), '51e00000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', (select m + 1 from mm), (select m + 5 from mm))$$,
  '22023', 'Месяц закрыт: табель этого периода только читается', 'Новый табель в закрытом месяце не создаётся');
select throws_ok($$update public.timesheets set status = 'draft'$$, '22023', 'Месяц закрыт: табель этого периода только читается', 'Статус табеля закрытого месяца не меняется');
select throws_ok($$insert into public.accruals (org_id, assignment_id, shift_id, shift_date, site_id, client_id, worker_id, kind, tax_status, reason_id, period_month, amount_worker)
  select a.org_id, a.id, a.shift_id, (select m + 14 from mm), '51e00000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001', a.worker_id, 'bonus', 'self_employed',
         (select id from public.directories where kind = 'bonus_reason' limit 1), (select m from mm), 10 from public.assignments a limit 1$$,
  '22023', 'Месяц закрыт: оформите корректировку в текущем периоде', 'Начисление в закрытый месяц не вставить и напрямую');

-- Корректировка идёт в текущий период и разрешена
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select lives_ok($$select public.add_correction((select id from public.accruals where kind = 'main' limit 1), -100, -50,
   (select id from public.directories where kind = 'deduction_reason' limit 1), 'Пересчёт после закрытия')$$, 'Поправка закрытого месяца оформляется корректировкой в текущем периоде');
select is((select period_month from public.accruals where kind = 'correction'), date_trunc('month', current_date)::date, 'Корректировка принадлежит текущему месяцу');

-- ------------------------------------------------------------
-- Открытие месяца руководителем
-- ------------------------------------------------------------
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select throws_ok($$select public.reopen_month(private.default_org_id(), (select m from mm), 'Нужно поправить')$$, '42501', null, 'Бухгалтер месяц не открывает');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select throws_ok($$select public.reopen_month(private.default_org_id(), (select m from mm), '')$$, '22023', null, 'Руководитель без причины тоже');
select lives_ok($$select public.reopen_month(private.default_org_id(), (select m from mm), 'Ошибка в часах')$$, 'Руководитель открывает месяц с причиной');
select is((select is_closed || '/' || reopen_reason from public.period_locks where month = (select m from mm)), 'false/Ошибка в часах', 'Причина сохранена');
select ok((select count(*) from public.audit_log where table_name = 'period_locks') >= 2, 'Закрытие и открытие записаны в журнал');
reset role;
set local app.timesheet_internal = 'on';
select lives_ok($$update public.assignments set approved_hours = 10$$, 'В открытом месяце часы снова можно править');
set local role authenticated;

-- ------------------------------------------------------------
-- Выгрузка в 1С
-- ------------------------------------------------------------
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select count(*)::int from public.export_1c_documents(private.default_org_id(), current_date, current_date)), 2, 'Выгрузка документов: акт и счёт');
select is((select amount_total from public.export_1c_documents(private.default_org_id(), current_date, current_date) where doc_kind = 'Счёт'), 9000.00, 'Сумма счёта 9 000');
select is((select client_inn from public.export_1c_documents(private.default_org_id(), current_date, current_date) limit 1), '5612345678', 'Заказчик в выгрузке — по ИНН');
select is((select count(*)::int from public.export_1c_document_lines(private.default_org_id(), current_date, current_date)), 2, 'Строки документов выгружаются: по одной в акте и счёте');
select is((select count(*)::int from public.export_1c_clients(private.default_org_id())), 1, 'Справочник заказчиков');
select is((select count(*)::int from public.export_1c_payments(private.default_org_id(), current_date - 30, current_date)), 0, 'Оплат пока нет');
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select * from public.export_1c_clients(private.default_org_id())$$, '42501', null, 'Продавцу выгрузка недоступна');

select * from finish();
rollback;
