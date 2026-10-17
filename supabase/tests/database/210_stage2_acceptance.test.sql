-- Приёмка этапа 2 (ТЗ, раздел 20): за неделю по заказчику с двумя объектами формируется один акт, сумма равна сумме подтверждённых
-- начислений до копейки; выписка с тремя платежами разносится автоматически, долг и просрочка пересчитываются сразу;
-- реестр на 30 исполнителей сам делится на платформу и банк; исполнитель без реквизитов и снятый с учёта самозанятый
-- в него не попадают; аванс удерживается; строка с ошибкой возвращается в «к выплате», остальные проведены и имеют чеки.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);
set local app.pii_key = 'test-key-0123456789abcdef0123456789abcdef';

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('ac000000-0000-0000-0000-0000000000ac', 'acc@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 30) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'site_manager' where user_id = '5c000000-0000-0000-0000-0000000000c1';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объектов', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');

insert into public.clients (id, org_id, name, inn, sales_manager_id, sites_manager_id, status) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '5612345678', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active');
insert into public.contracts (id, org_id, client_id, number, signed_on, billing_period, payment_delay_days, status)
  values ('c0170000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Д-1', current_date - 400, 'week', 5, 'active');
insert into public.sites (id, name, client_id, site_manager_id, status, latitude, longitude, checkin_method) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.7682, 55.097, 'geo'),
  ('51e00000-0000-0000-0000-000000000002', 'Склад 2', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.77, 55.1, 'geo');
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 400, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
-- Нечётные — самозанятые (платформа), чётные — ИП (банк)
update public.workers w set tax_status = case when n % 2 = 1 then 'self_employed' else 'ip' end
  from (select user_id, (('x' || substr(user_id::text, 7, 2))::bit(8)::int) as n from public.workers where user_id in (select pg_temp.w(i) from generate_series(1, 30) i)) q
  where w.user_id = q.user_id;
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from generate_series(1, 30) i, public.positions p
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';

-- Два объекта по 15 человек, все отработали по 10 часов
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select o.id, private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', o.site, p.id, current_date + 2, current_date + 2, '08:00', '19:00', 15, 0, 60
  from public.positions p
  join (values ('a1000000-0000-0000-0000-000000000001'::uuid, '51e00000-0000-0000-0000-000000000001'::uuid),
               ('a2000000-0000-0000-0000-000000000002'::uuid, '51e00000-0000-0000-0000-000000000002'::uuid)) o(id, site) on true
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order(id) from public.orders;
select public.assign_workers((select array_agg(s.id) from public.shifts s where s.order_id = 'a1000000-0000-0000-0000-000000000001'),
                             (select array_agg(pg_temp.w(i)) from generate_series(1, 15) i));
select public.assign_workers((select array_agg(s.id) from public.shifts s where s.order_id = 'a2000000-0000-0000-0000-000000000002'),
                             (select array_agg(pg_temp.w(i)) from generate_series(16, 30) i));
reset role;
update public.assignments set status = 'worked', planned_hours = 10, approved_hours = 10;
select private.create_accrual_for_assignment(id) from public.assignments;
update public.accruals set shift_date = current_date - 12;
select is((select count(*)::int from public.accruals where kind = 'main'), 30, 'Подготовка: 30 основных начислений');

-- ------------------------------------------------------------
-- Акт за неделю по заказчику с двумя объектами
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
create temp table act as select public.generate_client_documents('c1000000-0000-0000-0000-000000000001', current_date - 14, current_date - 8) as id;
grant select on act to authenticated;
select is((select count(*)::int from public.client_documents where kind in ('act', 'upd') and status = 'draft'), 1, 'За неделю сформирован один акт');
select is((select count(*)::int from public.client_document_lines where document_id = (select id from act)), 2, 'в нём две строки — по объектам');
select is((select amount_total from public.client_documents where id = (select id from act)),
          (select sum(amount_client) from public.accruals where kind = 'main'), 'Сумма акта равна сумме подтверждённых начислений до копейки');
select is((select amount_total from public.client_documents where id = (select id from act)), 135000.00, 'это 30 × 4 500 = 135 000');
select public.issue_client_documents((select id from act));
reset role;
-- Срок оплаты прошёл 40 дней назад
update public.client_documents set due_date = current_date - 40 where kind = 'invoice';
select is((select number from public.client_documents where kind = 'invoice'), 'СЧ-' || extract(year from current_date)::int || '/1', 'Счёт выставлен под номером 1');

-- ------------------------------------------------------------
-- Выписка из трёх платежей
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
create temp table imp as select public.import_bank_statement(private.default_org_id(), 'kl_to_1c.txt', NULL, jsonb_build_array(
  jsonb_build_object('date', current_date, 'amount', 50000, 'number', '1', 'payer_inn', '5612345678', 'purpose', 'Оплата по счёту СЧ-' || extract(year from current_date)::int || '/1 часть 1'),
  jsonb_build_object('date', current_date, 'amount', 60000, 'number', '2', 'payer_inn', '5612345678', 'purpose', 'Оплата по счёту СЧ-' || extract(year from current_date)::int || '/1 часть 2'),
  jsonb_build_object('date', current_date, 'amount', 25000, 'number', '3', 'payer_inn', '5612345678', 'purpose', 'Оплата по счёту СЧ-' || extract(year from current_date)::int || '/1 остаток')
)) as r;
grant select on imp to authenticated;
select is((select r->>'allocated' from imp), '3', 'Три платежа разнесены автоматически');
select is((select r->>'queue' from imp), '0', 'очередь пуста');
select is((select status from public.client_documents where kind = 'invoice'), 'paid', 'Счёт оплачен полностью');
select is((select debt || '/' || overdue_60 from public.client_receivables() where client_id = 'c1000000-0000-0000-0000-000000000001'), '0.00/0.00', 'Долг и просрочка пересчитались сразу: ноль');

-- ------------------------------------------------------------
-- Реестр выплат на 30 исполнителей
-- ------------------------------------------------------------
-- Реквизиты у всех, кроме тридцатого; двадцать девятый — самозанятый, снятый с учёта
do $$
declare i int;
begin
  perform set_config('request.jwt.claim.sub', 'ac000000-0000-0000-0000-0000000000ac', true);
  for i in 1..29 loop
    perform public.submit_payout_requisites(pg_temp.w(i), case when (select tax_status from public.workers where user_id = pg_temp.w(i)) = 'self_employed' then 'platform' else 'bank_account' end,
      case when (select tax_status from public.workers where user_id = pg_temp.w(i)) = 'self_employed' then '+7900000' || lpad(i::text, 4, '0') else '408178100000000' || lpad(i::text, 5, '0') end);
  end loop;
end $$;
reset role;
update public.workers set npd_status = 'active', npd_checked_at = now() where tax_status = 'self_employed';
update public.workers set npd_status = 'inactive' where user_id = pg_temp.w(29);

-- Аванс второму исполнителю (ИП) — выдан заранее; его начисление принадлежит текущему месяцу, от него считается лимит аванса
reset role;
update public.accruals set shift_date = current_date where worker_id = pg_temp.w(2);
set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select public.create_advance(pg_temp.w(2), 1000, 'К зарплате');
select public.build_payout_registries(private.default_org_id(), current_date - 30, current_date, 'advance');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select public.confirm_payout_registry(id) from public.payout_registries where kind = 'advance';
reset role;
select private.mark_line_paid(id, 'bank-adv', null) from public.payout_lines;
select is((select status from public.worker_advances), 'issued', 'Аванс выдан заранее');

set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
create temp table pay as select public.build_payout_registries(private.default_org_id(), current_date - 30, current_date) as r;
grant select on pay to authenticated;
select is((select jsonb_array_length(r->'registries') from pay), 2, 'Реестр сам разделился на платформу и банк');
select is((select lines_count from public.payout_registries where kind = 'payment' and channel = 'platform'), 14, 'На платформу ушли 14 самозанятых');
select is((select lines_count from public.payout_registries where kind = 'payment' and channel = 'bank'), 14, 'В банк — 14 ИП');
select is((select r->>'excluded' from pay), '2', 'Двое не включены');
select ok((select 'Нет подтверждённых реквизитов' = any(reasons) from public.payout_exclusions where worker_id = pg_temp.w(30)), 'Без реквизитов в реестр не попал');
select ok((select 'Самозанятый снят с учёта в ФНС' = any(reasons) from public.payout_exclusions where worker_id = pg_temp.w(29)), 'Снятый с учёта самозанятый не попал');
select is((select total_amount from public.payout_registries where kind = 'payment' and channel = 'platform'), 42000.00, 'Платформа: 14 × 3 000');
select is((select total_amount from public.payout_registries where kind = 'payment' and channel = 'bank'), 41000.00, 'Банк: 14 × 3 000 минус удержанный аванс 1 000');
select is((select advance_held from public.payout_lines where worker_id = pg_temp.w(2) and registry_id in (select id from public.payout_registries where kind = 'payment')), 1000.00, 'Аванс удержан у второго исполнителя');

-- Подтверждение вторым лицом и проведение
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select public.confirm_payout_registry(id) from public.payout_registries where kind = 'payment';
reset role;
update public.payout_registries set status = 'sent' where kind = 'payment';
select private.mark_line_paid(l.id, 'p-' || l.worker_id, 'https://lknpd.nalog.ru/' || l.worker_id)
  from public.payout_lines l join public.payout_registries r on r.id = l.registry_id where r.kind = 'payment' and l.worker_id <> pg_temp.w(4);
select private.mark_line_error(l.id, 'Банк вернул платёж: неверный счёт')
  from public.payout_lines l join public.payout_registries r on r.id = l.registry_id where r.kind = 'payment' and l.worker_id = pg_temp.w(4);
select is((select status from public.payout_registries where kind = 'payment' and channel = 'platform'), 'paid', 'Реестр платформы проведён целиком');
select is((select status from public.payout_registries where kind = 'payment' and channel = 'bank'), 'errors', 'В реестре банка одна ошибка');
select is((select count(*)::int from public.payout_lines where status = 'paid' and registry_id in (select id from public.payout_registries where kind = 'payment')), 27, 'Остальные 27 строк проведены');
select is((select count(*)::int from public.payout_lines l join public.payout_registries r on r.id = l.registry_id where r.channel = 'platform' and l.status = 'paid' and l.receipt is not null), 14, 'У всех 14 самозанятых есть чеки НПД');
select is((select payout_line_id is null and status in ('approved', 'in_act') from public.accruals where worker_id = pg_temp.w(4)), true, 'Сумма ошибочной строки вернулась в «к выплате»');
select is((select count(*)::int from public.accruals where status = 'paid'), 27, 'Выплачено 27 начислений из 30; 2 исключённых и ошибочное ждут');
select * from finish();
rollback;
