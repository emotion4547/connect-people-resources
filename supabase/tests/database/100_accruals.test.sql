-- Шаг 10: начисления и маржа.
-- Приёмка из ТЗ (раздел 11): три примера из таблицы воспроизводятся до копейки; ночная смена с коэффициентом
-- 1,2 считается верно; правка тарифа не меняет уже созданные начисления.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(61);

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('5d000000-0000-0000-0000-0000000000d2', 'sm2@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'cu@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 7) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'site_manager' where user_id in ('5c000000-0000-0000-0000-0000000000c1', '5d000000-0000-0000-0000-0000000000d2');
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
update public.user_roles set role = 'client_admin' where user_id = 'c0000000-0000-0000-0000-00000000000c';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта 1', 'sites'),
  ('5d000000-0000-0000-0000-0000000000d2', 'Менеджер объекта 2', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');

insert into public.clients (id, org_id, name, sales_manager_id, sites_manager_id) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1');
insert into public.client_contacts (org_id, client_id, full_name, user_id, cabinet_role)
  values (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Кабинет 1', 'c0000000-0000-0000-0000-00000000000c', 'client_admin');
insert into public.sites (id, name, client_id, site_manager_id, status, latitude, longitude, checkin_method) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active', 51.7682, 55.097, 'geo');
-- Тариф «Грузчик»: ночной коэффициент 1,2 и переработка 1,5. Тариф «Упаковщик»: минимум 4 часа заказчику.
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, night_coef, overtime_coef, min_paid_hours, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300,
         case p.name when 'Грузчик' then 1.2 else 1 end, case p.name when 'Грузчик' then 1.5 else 1 end,
         case p.name when 'Упаковщик' then 4 else 0 end, current_date - 30, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name in ('Грузчик', 'Упаковщик');
update public.workers set tax_status = case user_id
    when pg_temp.w(1) then 'ip' when pg_temp.w(3) then 'gph' when pg_temp.w(6) then 'ip' when pg_temp.w(7) then 'ip'
    else 'self_employed' end
  where user_id in (select pg_temp.w(i) from generate_series(1, 7) i);
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from generate_series(1, 7) i, public.positions p
  where p.org_id = private.default_org_id() and p.name in ('Грузчик', 'Упаковщик');

-- ------------------------------------------------------------
-- Заказы и назначения
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select o.id, private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
         current_date + o.d, current_date + o.d, o.st::time, o.en::time, o.n, 0, o.br
  from public.positions p
  join (values
    ('a1000000-0000-0000-0000-000000000001'::uuid, 'Грузчик',   2, '08:00', '19:00', 3, 60),
    ('a2000000-0000-0000-0000-000000000002'::uuid, 'Грузчик',   3, '22:00', '06:00', 1, 0),
    ('a3000000-0000-0000-0000-000000000003'::uuid, 'Упаковщик', 4, '08:00', '17:00', 1, 60),
    ('a4000000-0000-0000-0000-000000000004'::uuid, 'Грузчик',   5, '08:00', '21:00', 1, 60),
    ('a5000000-0000-0000-0000-000000000005'::uuid, 'Грузчик',   8, '08:00', '17:00', 1, 60)
  ) o(id, pos, d, st, en, n, br) on o.pos = p.name
  where p.org_id = private.default_org_id();
select public.accept_order(id) from public.orders where id::text like 'a_000000-0000-0000-0000-00000000000_';
select public.assign_workers((select array_agg(id) from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001'), array[pg_temp.w(1), pg_temp.w(2), pg_temp.w(3)]);
select public.assign_workers((select array_agg(id) from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), array[pg_temp.w(5)]);
select public.assign_workers((select array_agg(id) from public.shifts where order_id = 'a3000000-0000-0000-0000-000000000003'), array[pg_temp.w(4)]);
select public.assign_workers((select array_agg(id) from public.shifts where order_id = 'a4000000-0000-0000-0000-000000000004'), array[pg_temp.w(6)]);
select public.assign_workers((select array_agg(id) from public.shifts where order_id = 'a5000000-0000-0000-0000-000000000005'), array[pg_temp.w(7)]);

reset role;
create temp table aid as select regexp_replace(left(worker_id::text, 8), '^770000', '')::int as w, id from public.assignments;
grant select on aid to authenticated;
select is((select count(*)::int from aid), 7, 'Подготовка: семь назначений');

-- Часы после отметок: десять часов у троих, два у упаковщика, ночная смена 8 ч, переработка у шестого.
update public.assignments set status = 'worked', planned_hours = 10, approved_hours = 10 where worker_id in (pg_temp.w(1), pg_temp.w(2), pg_temp.w(3));
update public.assignments set status = 'worked', planned_hours = 8, approved_hours = 2 where worker_id = pg_temp.w(4);
update public.assignments set status = 'worked', planned_hours = 8, approved_hours = 8, night_hours = 8 where worker_id = pg_temp.w(5);
update public.assignments set status = 'worked', planned_hours = 10, approved_hours = 12, overtime_hours = 2, overtime_approved_hours = 2 where worker_id = pg_temp.w(6);
update public.assignments set status = 'worked', planned_hours = 8, approved_hours = 5 where worker_id = pg_temp.w(7);

-- Смена без тарифа: табель с такой строкой не отправляется
delete from public.shift_rates where shift_id in (select id from public.shifts where order_id = 'a5000000-0000-0000-0000-000000000005');

set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
create temp table ts as select public.build_timesheet('51e00000-0000-0000-0000-000000000001', current_date, current_date + 6) as id;
create temp table ts2 as select public.build_timesheet('51e00000-0000-0000-0000-000000000001', current_date + 7, current_date + 9) as id;
grant select on ts, ts2 to authenticated;
select throws_ok($$select public.send_timesheet((select id from ts2))$$, '22023', null, 'Табель со сменой без тарифа не отправляется');
select lives_ok($$select public.send_timesheet((select id from ts))$$, 'Табель с тарифами отправляется');

reset role;
select is((select count(*)::int from public.accruals), 0, 'Пока заказчик не подтвердил, начислений нет');
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select lives_ok($$select public.confirm_timesheet((select id from ts))$$, 'Заказчик подтверждает табель');

reset role;
select is((select count(*)::int from public.accruals where kind = 'main'), 6, 'Каждая подтверждённая строка дала основное начисление');

-- Три примера из ТЗ: 10 часов, 450 заказчику и 300 исполнителю на руки
select is((select amount_client || '/' || amount_worker || '/' || taxes || '/' || payout_fee || '/' || margin from public.accruals where worker_id = pg_temp.w(1)),
          '4500.00/3000.00/0.00/0.00/1500.00', 'ИП: к выставлению 4500, к выплате 3000, налогов нет, маржа 1500');
select is((select amount_client || '/' || amount_worker || '/' || taxes || '/' || payout_fee || '/' || margin from public.accruals where worker_id = pg_temp.w(2)),
          '4500.00/3000.00/0.00/60.00/1440.00', 'Самозанятый: комиссия 2% = 60, маржа 1440');
select is((select amount_client || '/' || amount_worker || '/' || taxes || '/' || payout_fee || '/' || margin from public.accruals where worker_id = pg_temp.w(3)),
          '4500.00/3000.00/1482.76/0.00/17.24', 'ГПХ: налоги и взносы 1482,76, маржа 17,24');
-- Ночная смена: все 8 часов ночные, коэффициент 1,2
select is((select amount_client || '/' || amount_worker || '/' || payout_fee || '/' || margin || '/' || coef from public.accruals where worker_id = pg_temp.w(5)),
          '4320.00/2880.00/57.60/1382.40/1.2000', 'Ночная смена: 8 ч × 1,2 по обеим ставкам');
-- Минимум оплачиваемых часов: заказчику четыре, исполнителю два
select is((select billable_quantity || '/' || payable_quantity || '/' || amount_client || '/' || amount_worker from public.accruals where worker_id = pg_temp.w(4)),
          '4.00/2.00/1800.00/600.00', 'Минимум часов применён к заказчику, не к исполнителю');
-- Переработка: 12 часов, из них 2 утверждённых с коэффициентом 1,5 → 13 условных часов
select is((select amount_client || '/' || amount_worker || '/' || coef from public.accruals where worker_id = pg_temp.w(6)),
          '5850.00/3900.00/1.0833', 'Утверждённая переработка идёт с коэффициентом');
select is((select count(*)::int from public.accruals where kind = 'main' and visible_to_client), 6, 'Основные начисления видны заказчику');

-- Правка тарифа не меняет созданные начисления
set local app.tariff_internal = 'on';
update public.tariffs set client_rate = 999, worker_rate = 777 where client_id = 'c1000000-0000-0000-0000-000000000001';
set local app.tariff_internal = 'off';
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select lives_ok($$select public.recalculate_accrual((select id from public.accruals where worker_id = pg_temp.w(1) and kind = 'main'))$$, 'Пересчёт начисления до акта');
select is((select amount_client from public.accruals where worker_id = pg_temp.w(1) and kind = 'main'), 4500.00, 'Ставки берутся из снимка на смене: новая ставка тарифа ничего не меняет');

-- Плановая и фактическая маржа смены
select is((select planned_margin || '/' || actual_margin from public.shift_money(current_date + 2, current_date + 2)),
          '2957.24/2957.24', 'Маржа смены: плановая равна фактической, пока часы по плану');
select is((select planned_client || '/' || planned_cost from public.shift_money(current_date + 2, current_date + 2)),
          '13500.00/10542.76', 'Плановые суммы смены: заказчику 13 500, себестоимость 10 542,76');

-- Заказчик, исполнитель и чужой менеджер деньги не видят
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select is((select count(*)::int from public.accruals), 0, 'Заказчик не видит таблицу начислений');
set local request.jwt.claim.sub = '77000001-0000-0000-0000-000000000000';
select is((select count(*)::int from public.accruals), 0, 'Исполнитель не видит таблицу начислений');
set local request.jwt.claim.sub = '5d000000-0000-0000-0000-0000000000d2';
select is((select count(*)::int from public.accruals), 0, 'Чужой менеджер не видит начислений');
select is((select count(*)::int from public.worker_statement(current_date, current_date + 9)), 0, 'Чужому менеджеру ведомость пуста');

-- ------------------------------------------------------------
-- Бонусы и удержания
-- ------------------------------------------------------------
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select lives_ok(
  $$select public.add_adjustment((select id from aid where w = 1), 'bonus', 500, (select id from public.directories where kind = 'bonus_reason' order by sort_order limit 1), 'Быстро разгрузили')$$,
  'Менеджер объекта добавляет бонус с причиной');
select is((select amount_worker || '/' || status from public.accruals where worker_id = pg_temp.w(1) and kind = 'bonus'), '500.00/approved', 'Бонус утверждён сразу');
select lives_ok(
  $$select public.add_adjustment((select id from aid where w = 1), 'deduction', 500, (select id from public.directories where kind = 'deduction_reason' order by sort_order limit 1), 'Порча паллеты')$$,
  'Удержание в пределах 30% начисления проходит сразу');
select is((select amount_worker || '/' || status from public.accruals where worker_id = pg_temp.w(1) and kind = 'deduction'), '-500.00/approved', 'Удержание хранится со знаком минус');
select lives_ok(
  $$select public.add_adjustment((select id from aid where w = 1), 'deduction', 1000, (select id from public.directories where kind = 'deduction_reason' order by sort_order limit 1), 'Большой ущерб')$$,
  'Удержание больше 30% создаётся');
select is((select status || '/' || needs_approval from public.accruals where worker_id = pg_temp.w(1) and amount_worker = -1000), 'draft/true', 'и ждёт согласования руководителя');
select throws_ok($$select public.approve_accrual((select id from public.accruals where amount_worker = -1000))$$, '42501', null, 'Менеджер объекта согласовать не может');
select throws_ok(
  $$select public.add_adjustment((select id from aid where w = 1), 'bonus', 100, null)$$,
  '22023', null, 'Без причины из справочника бонус не принимается');
select throws_ok(
  $$select public.add_adjustment((select id from aid where w = 1), 'bonus', -5, (select id from public.directories where kind = 'bonus_reason' limit 1))$$,
  '22023', null, 'Отрицательная сумма не принимается');
select lives_ok(
  $$select public.add_adjustment((select id from aid where w = 2), 'client_penalty', 300, (select id from public.directories where kind = 'deduction_reason' limit 1), 'Поздняя отмена заказчиком')$$,
  'Штраф заказчику добавляется');
select is((select amount_client || '/' || amount_worker || '/' || visible_to_client from public.accruals where kind = 'client_penalty'), '300.00/0.00/true', 'Штраф заказчику — только сумма заказчику и виден ему');
set local request.jwt.claim.sub = '5d000000-0000-0000-0000-0000000000d2';
select throws_ok(
  $$select public.add_adjustment((select id from aid where w = 1), 'bonus', 100, (select id from public.directories where kind = 'bonus_reason' limit 1))$$,
  '42501', null, 'Чужой менеджер бонус добавить не может');

set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select lives_ok($$select public.approve_accrual((select id from public.accruals where amount_worker = -1000))$$, 'Руководитель согласует большое удержание');
select is((select status from public.accruals where amount_worker = -1000), 'approved', 'Удержание утверждено');
select lives_ok(
  $$select public.add_adjustment((select id from aid where w = 1), 'deduction', 2000, (select id from public.directories where kind = 'deduction_reason' limit 1), 'Спорное')$$,
  'Ещё одно крупное удержание');
select lives_ok($$select public.approve_accrual((select id from public.accruals where amount_worker = -2000), false)$$, 'Руководитель его отклоняет');
select is((select count(*)::int from public.accruals where amount_worker = -2000), 0, 'Отклонённое удержание удалено');

-- Корректировка
select lives_ok(
  $$select public.add_correction((select id from public.accruals where worker_id = pg_temp.w(1) and kind = 'main'), -150, -100,
     (select id from public.directories where kind = 'deduction_reason' limit 1), 'Пересчёт по акту сверки')$$,
  'Руководитель оформляет корректировку');
select is((select amount_client || '/' || amount_worker || '/' || period_month from public.accruals where kind = 'correction'),
          '-150.00/-100.00/' || date_trunc('month', current_date)::date, 'Корректировка идёт в текущий период');
select throws_ok($$select public.add_correction((select id from public.accruals where kind = 'main' limit 1), 0, 0, (select id from public.directories where kind = 'bonus_reason' limit 1), 'x')$$,
                 '22023', null, 'Корректировка на ноль не принимается');

-- Неизменность
reset role;
select throws_ok($$update public.accruals set amount_client = 1 where kind = 'main'$$, '22023', null, 'Суммы начисления напрямую не правятся');
select throws_ok($$delete from public.accruals where kind = 'main'$$, '22023', null, 'Утверждённое начисление не удаляется');

-- ------------------------------------------------------------
-- Ведомости
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select is((select shifts || '/' || hours || '/' || accrued || '/' || bonuses || '/' || deductions || '/' || corrections || '/' || to_pay
           from public.worker_statement(current_date, current_date + 9) where worker_id = pg_temp.w(1)),
          '1/10.00/3000.00/500.00/-1500.00/-100.00/1900.00', 'Ведомость исполнителя: 3000 + 500 − 1500 − 100 = 1900');
select is((select count(*)::int from public.worker_statement(current_date, current_date + 9)), 6, 'В ведомости шесть исполнителей');
select is((select count(*)::int from public.client_statement(current_date, current_date + 9)), 1, 'Ведомость по заказчикам: один объект');
select is((select (to_invoice - cost = margin)::text from public.client_statement(current_date, current_date + 9)), 'true', 'Маржа = к выставлению − себестоимость');
select is((select to_invoice from public.client_statement(current_date, current_date + 9)), 13500.00 + 1800 + 4320 + 5850 + 300 - 150, 'К выставлению: все начисления заказчику с учётом штрафа и корректировки');

-- Менеджер объекта видит ведомость по своим объектам
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select is((select count(*)::int from public.worker_statement(current_date, current_date + 9)), 6, 'Менеджер объекта видит ведомость по своему объекту');

-- ------------------------------------------------------------
-- Пересчёт до акта и запрет после
-- ------------------------------------------------------------
reset role;
set local app.timesheet_internal = 'on';
update public.assignments set approved_hours = 6 where worker_id = pg_temp.w(4);
set local app.timesheet_internal = 'off';
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select lives_ok($$select public.recalculate_accrual((select id from public.accruals where worker_id = pg_temp.w(4) and kind = 'main'))$$, 'Часы изменились — основное начисление пересчитывается');
select is((select amount_client || '/' || amount_worker from public.accruals where worker_id = pg_temp.w(4) and kind = 'main'), '2700.00/1800.00', 'Пересчёт: 6 часов');
reset role;
update public.accruals set status = 'in_act' where worker_id = pg_temp.w(4) and kind = 'main';
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select throws_ok($$select public.recalculate_accrual((select id from public.accruals where worker_id = pg_temp.w(4) and kind = 'main'))$$,
                 '22023', null, 'После включения в акт пересчёт запрещён — только корректировка');
select throws_ok($$select public.recalculate_accrual((select id from public.accruals where kind = 'bonus'))$$, '22023', null, 'Пересчитывается только основное начисление');

-- Расчёт налогов напрямую
reset role;
select is((select o_taxes from private.calc_amounts(private.default_org_id(), 'gph', 3000, current_date)), 1482.76, 'Налоги ГПХ с 3000: 1482,76');
select is((select o_fee from private.calc_amounts(private.default_org_id(), 'self_employed', 3000, current_date)), 60.00, 'Комиссия самозанятого с 3000: 60');
select throws_ok($$select * from private.calc_amounts(private.default_org_id(), 'unknown', 3000, current_date)$$, '22023', null, 'Неизвестный статус не считается');

-- Настройка меняется после создания смены: пересчёт и корректировки сохраняют старые проценты.
insert into public.tax_status_rates (org_id, status, ndfl_pct, contributions_pct, effective_from)
values (private.default_org_id(), 'gph', 20, 30, current_date + 1);
select is((select o_taxes from private.calc_amounts(private.default_org_id(), 'gph', 3000, current_date + 2)),
  1875.00, 'Новая настройка действительно отличается от старой');
select is((select o_taxes from private.calc_amounts(private.default_org_id(), 'gph', 3000, current_date + 2,
  (select shift_id from public.accruals where worker_id = pg_temp.w(3) and kind = 'main'))),
  1482.76, 'Смена использует снимок налогов, а не новую настройку');
update public.workers set tax_status = 'ip' where user_id = pg_temp.w(3);
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select lives_ok($$select public.recalculate_accrual((select id from public.accruals where worker_id = pg_temp.w(3) and kind = 'main'))$$,
  'Пересчёт после изменения справочников доступен');
select is((select taxes from public.accruals where worker_id = pg_temp.w(3) and kind = 'main'), 1482.76,
  'Пересчёт сохраняет налоги и налоговый статус принятого начисления');
reset role;
select throws_ok($$update public.shift_rates set tax_snapshot = '{}'::jsonb$$, '22023', null, 'Снимок налогов нельзя переписать');

select * from finish();
rollback;
