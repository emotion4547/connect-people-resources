-- Шаг 11: кабинеты заказчика и исполнителя.
-- Заказчик не видит ставку исполнителя, телефоны и чужие данные; исполнитель не видит ставку заказчику.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(41);

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'cu@test.local'),
  ('c2000000-0000-0000-0000-0000000000c2', 'cu2@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 7) i;
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'site_manager' where user_id = '5c000000-0000-0000-0000-0000000000c1';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
update public.user_roles set role = 'client_admin' where user_id in ('c0000000-0000-0000-0000-00000000000c', 'c2000000-0000-0000-0000-0000000000c2');
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта 1', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');

insert into public.clients (id, org_id, name, sales_manager_id, sites_manager_id) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1'),
  ('c2000000-0000-0000-0000-000000000002', private.default_org_id(), 'Заказчик 2', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1');
insert into public.client_contacts (org_id, client_id, full_name, user_id, cabinet_role) values
  (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Кабинет 1', 'c0000000-0000-0000-0000-00000000000c', 'client_admin'),
  (private.default_org_id(), 'c2000000-0000-0000-0000-000000000002', 'Кабинет 2', 'c2000000-0000-0000-0000-0000000000c2', 'client_admin');
insert into public.sites (id, name, client_id, site_manager_id, status, address, latitude, longitude, instructions, contact_name, checkin_method) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1',
   'active', 'Оренбург, ул. Складская, 1', 51.7682, 55.097, 'Вход через КПП №2', 'Иван', 'geo');
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 30, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
update public.workers set tax_status = 'self_employed' where user_id in (select pg_temp.w(i) from generate_series(1, 7) i);
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from generate_series(1, 7) i, public.positions p
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';
-- Условия договора: бесплатная отмена за 72 часа, позже — половина оплаты
insert into public.org_settings (org_id, key, value) values
  (private.default_org_id(), 'cancel.client_free_hours', '72'), (private.default_org_id(), 'cancel.client_paid_pct', '50');

set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count, break_minutes)
  select o.id, private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
         current_date + o.d, current_date + o.d, '08:00', '19:00', o.n, 0, 60
  from public.positions p
  join (values
    ('a1000000-0000-0000-0000-000000000001'::uuid, 1, 3),
    ('a2000000-0000-0000-0000-000000000002'::uuid, 3, 3),
    ('a3000000-0000-0000-0000-000000000003'::uuid, 5, 1)
  ) o(id, d, n) on true
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order(id) from public.orders where id::text like 'a_000000-0000-0000-0000-00000000000_';
select public.assign_workers((select array_agg(id) from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001'), array[pg_temp.w(1), pg_temp.w(2), pg_temp.w(3)]);
select public.assign_workers((select array_agg(id) from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), array[pg_temp.w(1)]);
select public.assign_workers((select array_agg(id) from public.shifts where order_id = 'a3000000-0000-0000-0000-000000000003'), array[pg_temp.w(5)]);

reset role;
create temp table sh as select order_id, id from public.shifts;
grant select on sh to authenticated;
create temp table aid as select regexp_replace(left(a.worker_id::text, 8), '^770000', '')::int as w, a.id, s.order_id from public.assignments a join public.shifts s on s.id = a.shift_id;
grant select on aid to authenticated;
-- Приглашения: W6 и W7 приглашены на третий день
insert into public.assignments (org_id, shift_id, worker_id, status, source, shift_start, shift_end)
  select private.default_org_id(), s.id, pg_temp.w(i), 'invited', 'assigned', s.start_at, s.end_at
  from public.shifts s, generate_series(6, 7) i where s.order_id = 'a2000000-0000-0000-0000-000000000002';
update public.assignments set status = 'confirmed' where worker_id = pg_temp.w(1) and shift_id in (select id from sh where order_id = 'a1000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.shifts), 3, 'Подготовка: три смены');

-- ------------------------------------------------------------
-- Кабинет заказчика
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select is((select count(*)::int from public.client_tariffs()), 1, 'Заказчик видит свой тариф');
select is((select client_rate from public.client_tariffs()), 450.00, 'и свою ставку');
select is((select count(*)::int from public.tariffs), 0, 'но таблицу тарифов (со ставкой исполнителя) не читает');
select is((select count(*)::int from public.shift_rates), 0, 'и ставки смен не читает');
select is((select count(*)::int from public.client_shifts(current_date, current_date + 6)), 3, 'Смены заказчика в календаре');
select is((select assigned_count || '/' || confirmed_count || '/' || on_site_count || '/' || headcount
           from public.client_shifts(current_date, current_date + 1) where order_id = 'a1000000-0000-0000-0000-000000000001'),
          '3/1/0/3', 'Укомплектованность: назначено 3, подтвердил 1, на месте 0');
select is((select count(*)::int from public.client_shift_people((select id from sh where order_id = 'a1000000-0000-0000-0000-000000000001'))), 3, 'Список людей на смене');
select is((select count(*)::int from information_schema.columns where table_name = 'client_shift_people' and column_name in ('phone', 'passport')), 0,
          'В списке людей нет телефонов и паспортов');

set local request.jwt.claim.sub = 'c2000000-0000-0000-0000-0000000000c2';
select is((select count(*)::int from public.client_tariffs()), 0, 'Другой заказчик чужих тарифов не видит');
select is((select count(*)::int from public.client_shifts(current_date, current_date + 6)), 0, 'и чужих смен');
select throws_ok($$select * from public.client_shift_people((select id from sh limit 1))$$, '42501', null, 'и людей на чужой смене');
select throws_ok($$select public.client_cancel_shift((select id from sh limit 1), (select id from public.directories where kind = 'cancel_reason' limit 1))$$,
                 '42501', null, 'Чужую смену отменить нельзя');

-- Уменьшение числа людей поздно (меньше 72 часов): штраф по договору
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select throws_ok($$select public.client_reduce_shift((select id from sh where order_id = 'a1000000-0000-0000-0000-000000000001'), 3)$$,
                 '22023', null, 'Увеличить или оставить число людей нельзя');
select is(public.client_reduce_shift((select id from sh where order_id = 'a1000000-0000-0000-0000-000000000001'), 2), 1, 'Смена уменьшена до двух людей, снят один');
reset role;
select is((select headcount from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001'), 2, 'Потребность смены стала 2');
select is((select count(*)::int from public.assignments where shift_id in (select id from sh where order_id = 'a1000000-0000-0000-0000-000000000001')
           and status in ('assigned', 'confirmed')), 2, 'Остались двое');
select is((select amount_client || '/' || visible_to_client from public.accruals where kind = 'client_penalty'), '2250.00/true',
          'Поздняя уменьшение: штраф 50% от 10 ч × 450 = 2250, виден заказчику');

-- Отмена смены заблаговременно (за 5 дней): без штрафа
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select lives_ok($$select public.client_cancel_shift((select id from sh where order_id = 'a3000000-0000-0000-0000-000000000003'),
                  (select id from public.directories where kind = 'cancel_reason' order by sort_order limit 1))$$, 'Заказчик отменяет смену');
reset role;
select is((select status from public.shifts where order_id = 'a3000000-0000-0000-0000-000000000003'), 'cancelled', 'Смена отменена');
select is((select status from public.assignments where worker_id = pg_temp.w(5)), 'cancelled_manager', 'Назначение снято');
select is((select count(*)::int from public.accruals where kind = 'client_penalty'), 1, 'За своевременную отмену штрафа нет');

-- ------------------------------------------------------------
-- Кабинет исполнителя
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '77000001-0000-0000-0000-000000000000';
select is((select count(*)::int from public.worker_my_shifts(current_date, current_date + 6)), 2, 'Исполнитель видит свои смены');
select is((select worker_rate || '/' || planned_hours || '/' || est_earnings from public.worker_my_shifts(current_date, current_date + 1)),
          '300.00/10.00/3000.00', 'Своя ставка 300, 10 часов, ориентировочно 3000');
select is((select address || '/' || instructions from public.worker_my_shifts(current_date, current_date + 1)),
          'Оренбург, ул. Складская, 1/Вход через КПП №2', 'Адрес и инструкция видны');
select is((select can_check_in from public.worker_my_shifts(current_date, current_date + 1)), false, 'За день до смены отметиться нельзя');
select is((select can_cancel_free from public.worker_my_shifts(current_date + 3, current_date + 3)), true, 'За три дня отменить бесплатно можно');
select is((select count(*)::int from public.shift_rates), 0, 'Исполнитель не читает таблицу ставок');
select is((select count(*)::int from public.accruals), 0, 'и таблицу начислений');

set local request.jwt.claim.sub = '77000004-0000-0000-0000-000000000000';
select is((select count(*)::int from public.worker_open_shifts(current_date, current_date + 6)), 2, 'Свободные смены по своей позиции');
select is((select worker_rate || '/' || free_places from public.worker_open_shifts(current_date + 3, current_date + 3)), '300.00/2', 'Видна ставка исполнителю и свободные места');
select is(public.respond_to_shifts((select array_agg(id) from sh where order_id = 'a2000000-0000-0000-0000-000000000002')), 1, 'Исполнитель откликается');
select is((select count(*)::int from public.worker_open_shifts(current_date + 3, current_date + 3)), 0, 'После отклика смена уходит из свободных');

-- Приглашения
set local request.jwt.claim.sub = '77000006-0000-0000-0000-000000000000';
select lives_ok($$select public.accept_invitation((select id from public.assignments where worker_id = pg_temp.w(6)))$$, 'Исполнитель принимает приглашение');
select is((select status from public.assignments where worker_id = pg_temp.w(6)), 'assigned', 'и становится назначенным');
set local request.jwt.claim.sub = '77000007-0000-0000-0000-000000000000';
select lives_ok($$select public.decline_invitation((select id from public.assignments where worker_id = pg_temp.w(7)))$$, 'Исполнитель отклоняет приглашение');
select throws_ok($$select public.accept_invitation((select id from public.assignments where worker_id = pg_temp.w(6)))$$, '22023', null, 'Чужое приглашение принять нельзя');

-- Заработок
reset role;
update public.assignments set status = 'worked', planned_hours = 10, approved_hours = 10 where worker_id = pg_temp.w(1) and shift_id in (select id from sh where order_id = 'a2000000-0000-0000-0000-000000000002');
select private.create_accrual_for_assignment((select a.id from public.assignments a where a.worker_id = pg_temp.w(1) and a.status = 'worked'));

set local role authenticated;
set local request.jwt.claim.sub = '77000001-0000-0000-0000-000000000000';
select is((select kind || '/' || hours || '/' || amount from public.worker_earnings(current_date, current_date + 6)), 'main/10.00/3000.00', 'Заработок по смене: 10 часов, 3000');
set local request.jwt.claim.sub = '77000002-0000-0000-0000-000000000000';
select is((select count(*)::int from public.worker_earnings(current_date, current_date + 6)), 0, 'Чужой заработок не виден');
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select is((select amount_client from public.client_accruals(current_date, current_date + 6) where kind = 'main'), 4500.00, 'Заказчик видит свою сумму 4500');
set local request.jwt.claim.sub = 'c2000000-0000-0000-0000-0000000000c2';
select is((select count(*)::int from public.client_accruals(current_date, current_date + 6)), 0, 'Чужой заказчик сумм не видит');

select * from finish();
rollback;
