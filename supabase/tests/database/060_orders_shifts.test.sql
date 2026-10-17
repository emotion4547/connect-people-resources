-- Шаг 6: заказы и смены.
-- Приёмка из ТЗ (раздел 8): заказ на 5 дней × 10 человек с ночной сменой 20:00–08:00 даёт 5 смен.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(61);

create function pg_temp.rows_changed(_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute _sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.rows_changed(text) to authenticated;

-- Организация 1: SM — менеджер объекта (ответственный за заказчика 1), SM2 — другой менеджер объекта,
-- S1 — продажи, D — руководитель, CU — человек из кабинета заказчика 1, CU2 — заказчика 2.
-- Организация 2: B — администратор.
insert into public.organizations (id, name) values ('b2000000-0000-0000-0000-000000000002', 'Вторая организация');
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('5d000000-0000-0000-0000-0000000000d2', 'sm2@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'b@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'cu@test.local'),
  ('c9000000-0000-0000-0000-000000000009', 'cu2@test.local');
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'site_manager' where user_id in ('5c000000-0000-0000-0000-0000000000c1', '5d000000-0000-0000-0000-0000000000d2');
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
update public.user_roles set role = 'admin' where user_id = 'b0000000-0000-0000-0000-00000000000b';
update public.user_roles set role = 'client_admin' where user_id in ('c0000000-0000-0000-0000-00000000000c', 'c9000000-0000-0000-0000-000000000009');
update public.user_roles set org_id = 'b2000000-0000-0000-0000-000000000002' where user_id = 'b0000000-0000-0000-0000-00000000000b';
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объекта 1', 'sites'),
  ('5d000000-0000-0000-0000-0000000000d2', 'Менеджер объекта 2', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');

insert into public.clients (id, org_id, name, sales_manager_id, sites_manager_id) values
  ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Заказчик 1', '51000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1'),
  ('c2000000-0000-0000-0000-000000000002', private.default_org_id(), 'Заказчик 2', '51000000-0000-0000-0000-000000000001', '5d000000-0000-0000-0000-0000000000d2');
insert into public.client_contacts (org_id, client_id, full_name, user_id, cabinet_role) values
  (private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Кабинет 1', 'c0000000-0000-0000-0000-00000000000c', 'client_admin'),
  (private.default_org_id(), 'c2000000-0000-0000-0000-000000000002', 'Кабинет 2', 'c9000000-0000-0000-0000-000000000009', 'client_admin');
insert into public.sites (id, name, client_id, site_manager_id, status) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active'),
  ('51e00000-0000-0000-0000-000000000002', 'Склад 2 (запуск)', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'launch'),
  ('51e00000-0000-0000-0000-000000000003', 'Склад заказчика 2', 'c2000000-0000-0000-0000-000000000002', '5d000000-0000-0000-0000-0000000000d2', 'active');
-- Утверждённый тариф заказчика 1 на «Грузчик» (ночной коэффициент 1,2), действует с прошлого месяца.
insert into public.tariffs (id, org_id, client_id, position_id, client_rate, worker_rate, night_coef, valid_from, status)
  select 'f1000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, 1.2, current_date - 30, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
-- У заказчика 2 тариф тоже есть (для заказа из кабинета).
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c2000000-0000-0000-0000-000000000002', p.id, 400, 280, current_date - 30, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';

-- ------------------------------------------------------------
-- Менеджер объекта SM: заказ на 5 дней, ночная смена
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';

select lives_ok(
  $$insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount)
    select 'a1000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001',
           '51e00000-0000-0000-0000-000000000001', p.id, current_date + 1, current_date + 5, '20:00', '08:00', 10
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик'$$,
  'Менеджер создаёт заказ на 5 дней × 10 человек с ночной сменой'
);
select is((select status from public.orders where id = 'a1000000-0000-0000-0000-000000000001'), 'new', 'Новый заказ в статусе «Новый»');
select is(
  (select starts_at from public.orders where id = 'a1000000-0000-0000-0000-000000000001'),
  (((current_date + 1) + time '20:00')::timestamp at time zone 'Asia/Yekaterinburg'),
  'Начало первой смены считается по часовому поясу объекта'
);
select is(public.accept_order('a1000000-0000-0000-0000-000000000001'), 5, 'Принятый заказ даёт 5 смен');
select is((select status from public.orders where id = 'a1000000-0000-0000-0000-000000000001'), 'accepted', 'Заказ принят');
select is(
  (select count(*)::int from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001' and end_at - start_at = interval '12 hours'),
  5, 'Ночная смена через полночь — одна смена на 12 часов, а не две'
);
select is(
  (select min(start_at) from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001'),
  (((current_date + 1) + time '20:00')::timestamp at time zone 'Asia/Yekaterinburg'),
  'Смена начинается в 20:00 по времени объекта'
);
select is(
  (select count(*)::int from public.shift_rates r join public.shifts s on s.id = r.shift_id
    where s.order_id = 'a1000000-0000-0000-0000-000000000001' and r.client_rate = 450 and r.worker_rate = 300 and r.night_coef = 1.2),
  5, 'В каждую смену скопированы ставки тарифа'
);
select throws_ok($$select public.accept_order('a1000000-0000-0000-0000-000000000001')$$, '22023', null, 'Принять можно только новый заказ');

-- Проверки заказа
select throws_ok(
  $$insert into public.orders (org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount)
    select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
           current_date + 1, current_date + 2, '08:00', '17:00', 3
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Упаковщик'$$,
  '22023', null, 'Заказ без утверждённого тарифа создать нельзя'
);
select throws_ok(
  $$insert into public.orders (org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount)
    select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
           current_date + 1, current_date + 2, '08:00', '17:00', 0
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик'$$,
  '23514', null, 'Число людей — не меньше одного'
);
select throws_ok(
  $$insert into public.orders (org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount)
    select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
           current_date + 1, current_date + 2, '08:00', '08:00', 3
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик'$$,
  '23514', null, 'Начало и конец смены не совпадают'
);

-- Дни недели и список дат
select lives_ok(
  $$insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, weekdays, start_time, end_time, headcount)
    select 'a2000000-0000-0000-0000-000000000002', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001',
           '51e00000-0000-0000-0000-000000000001', p.id, current_date + 10, current_date + 23, ARRAY[1,2,3,4,5]::smallint[], '08:00', '17:00', 4
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик'$$,
  'Заказ по будням на две недели'
);
select is(
  public.accept_order('a2000000-0000-0000-0000-000000000002'),
  (select count(*)::int from generate_series(current_date + 10, current_date + 23, interval '1 day') g where extract(isodow from g) <= 5),
  'Смены созданы только в будни'
);
select lives_ok(
  $$insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, dates, start_time, end_time, headcount)
    select 'a3000000-0000-0000-0000-000000000003', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001',
           '51e00000-0000-0000-0000-000000000001', p.id, current_date, current_date,
           ARRAY[current_date + 44, current_date + 40, current_date + 42], '09:00', '18:00', 2
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик'$$,
  'Заказ по списку дат'
);
select is((select date_from from public.orders where id = 'a3000000-0000-0000-0000-000000000003'), current_date + 40, 'Период заказа взят из списка дат');
select is(public.accept_order('a3000000-0000-0000-0000-000000000003'), 3, 'По списку из трёх дат — три смены');

-- Чужой менеджер объекта
set local request.jwt.claim.sub = '5d000000-0000-0000-0000-0000000000d2';
select throws_ok(
  $$insert into public.orders (org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount)
    select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
           current_date + 1, current_date + 2, '08:00', '17:00', 3
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик'$$,
  '42501', null, 'Чужой менеджер не создаёт заказ на не свой объект'
);
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select lives_ok(
  $$insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount)
    select 'a4000000-0000-0000-0000-000000000004', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001',
           '51e00000-0000-0000-0000-000000000001', p.id, current_date + 3, current_date + 4, '08:00', '17:00', 3
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик'$$,
  'Заказ ждёт принятия'
);
set local request.jwt.claim.sub = '5d000000-0000-0000-0000-0000000000d2';
select throws_ok($$select public.accept_order('a4000000-0000-0000-0000-000000000004')$$, '42501', null, 'Чужой менеджер не принимает заказ');

-- ------------------------------------------------------------
-- Смена не меняется при правке тарифа
-- ------------------------------------------------------------
reset role;
select set_config('app.tariff_internal', 'on', true);
update public.tariffs set worker_rate = 999 where id = 'f1000000-0000-0000-0000-000000000001';
select set_config('app.tariff_internal', 'off', true);
select is(
  (select count(*)::int from public.shift_rates r join public.shifts s on s.id = r.shift_id
    where s.order_id = 'a1000000-0000-0000-0000-000000000001' and r.worker_rate = 300),
  5, 'После правки тарифа уже созданные смены остались со старой ставкой'
);
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select is(public.accept_order('a4000000-0000-0000-0000-000000000004'), 2, 'Новый принятый заказ берёт актуальную ставку');
select is(
  (select count(*)::int from public.shift_rates r join public.shifts s on s.id = r.shift_id
    where s.order_id = 'a4000000-0000-0000-0000-000000000004' and r.worker_rate = 999),
  2, 'Ставка новых смен — по текущему тарифу'
);

-- ------------------------------------------------------------
-- Публикация смен после запуска объекта
-- ------------------------------------------------------------
select lives_ok(
  $$insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount)
    select 'a5000000-0000-0000-0000-000000000005', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001',
           '51e00000-0000-0000-0000-000000000002', p.id, current_date + 3, current_date + 4, '08:00', '17:00', 3
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик'$$,
  'Заказ на объект в статусе «Запуск»'
);
select is(public.accept_order('a5000000-0000-0000-0000-000000000005'), 2, 'Смены создаются');
select is((select count(*)::int from public.shifts where order_id = 'a5000000-0000-0000-0000-000000000005' and published_at is not null), 0,
  'но на объекте в запуске не публикуются');
reset role;
update public.sites set status = 'active' where id = '51e00000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.shifts where order_id = 'a5000000-0000-0000-0000-000000000005' and published_at is not null), 2,
  'После запуска объекта смены публикуются');

-- ------------------------------------------------------------
-- Правка заказа: план изменения смен
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select lives_ok(
  $$insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount)
    select 'a6000000-0000-0000-0000-000000000006', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001',
           '51e00000-0000-0000-0000-000000000001', p.id, current_date + 60, current_date + 62, '08:00', '17:00', 5
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик'$$,
  'Заказ на три дня'
);
select is(public.accept_order('a6000000-0000-0000-0000-000000000006'), 3, 'Три смены');
select is(pg_temp.rows_changed($$update public.orders set date_to = current_date + 64 where id = 'a6000000-0000-0000-0000-000000000006'$$), 1, 'Менеджер удлиняет заказ');
select is((select count(*)::int from public.regenerate_order_shifts('a6000000-0000-0000-0000-000000000006', true) where action = 'add'), 2, 'План: две новые смены');
select is((select count(*)::int from public.shifts where order_id = 'a6000000-0000-0000-0000-000000000006'), 3, 'Пробный расчёт смены не создаёт');
select is((select count(*)::int from public.regenerate_order_shifts('a6000000-0000-0000-0000-000000000006', false) where action = 'add'), 2, 'Применение добавляет их');
select is((select count(*)::int from public.shifts where order_id = 'a6000000-0000-0000-0000-000000000006'), 5, 'Теперь пять смен');
select is(pg_temp.rows_changed($$update public.orders set date_to = current_date + 61 where id = 'a6000000-0000-0000-0000-000000000006'$$), 1, 'Менеджер сокращает заказ');
select is((select count(*)::int from public.regenerate_order_shifts('a6000000-0000-0000-0000-000000000006', false) where action = 'remove'), 3, 'Лишние будущие смены без людей убираются');
select is((select count(*)::int from public.shifts where order_id = 'a6000000-0000-0000-0000-000000000006'), 2, 'Остались две смены');

-- Повторить неделю
select lives_ok($$select public.repeat_order_week('a6000000-0000-0000-0000-000000000006')$$, 'Менеджер повторяет неделю');
select is(
  (select count(*)::int from public.orders where date_from = current_date + 67 and status = 'accepted' and source = 'manager'), 1,
  'Копия заказа сдвинута на 7 дней и сразу принята'
);

-- Отмена
select throws_ok(
  $$select public.cancel_order('a6000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000')$$,
  '22023', null, 'Отмена требует причину из справочника'
);
select lives_ok(
  $$select public.cancel_order('a6000000-0000-0000-0000-000000000006',
      (select id from public.directories where org_id = private.default_org_id() and kind = 'cancel_reason' and name = 'Смену отменил заказчик'))$$,
  'Заказ отменяется с причиной'
);
select is((select count(*)::int from public.shifts where order_id = 'a6000000-0000-0000-0000-000000000006' and status = 'cancelled'), 2, 'Будущие смены отменены');
select throws_ok(
  $$select public.cancel_order('a6000000-0000-0000-0000-000000000006',
      (select id from public.directories where org_id = private.default_org_id() and kind = 'cancel_reason' limit 1))$$,
  '22023', null, 'Отменённый заказ повторно не отменяется'
);

-- ------------------------------------------------------------
-- Прошедшие смены не трогаются, статусы по времени
-- ------------------------------------------------------------
reset role;
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, status)
  select 'a9000000-0000-0000-0000-000000000009', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001',
         '51e00000-0000-0000-0000-000000000001', p.id, current_date - 1, current_date + 1, '08:00', '17:00', 2, 'accepted'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
insert into public.shifts (org_id, order_id, client_id, site_id, position_id, shift_date, start_at, end_at, headcount)
  select o.org_id, o.id, o.client_id, o.site_id, o.position_id, v.d, v.s, v.e, 2
  from public.orders o, (values
    (current_date - 1, now() - interval '30 hours', now() - interval '20 hours'),
    (current_date,     now() - interval '1 hour',   now() + interval '1 hour'),
    (current_date + 1, now() + interval '20 hours', now() + interval '30 hours')) v(d, s, e)
  where o.id = 'a9000000-0000-0000-0000-000000000009';
select is(private.advance_shift_statuses(), 2, 'Время двинуло две смены: одну в «Идёт», одну в «Завершена»');
select is(
  (select string_agg(status, ',' order by shift_date) from public.shifts where order_id = 'a9000000-0000-0000-0000-000000000009'),
  'completed,running,open', 'Статусы смен соответствуют времени');
select is((select status from public.orders where id = 'a9000000-0000-0000-0000-000000000009'), 'in_progress', 'Заказ перешёл в «В работе»');
update public.shifts set status = 'completed' where order_id = 'a9000000-0000-0000-0000-000000000009';
select private.advance_shift_statuses();
select is((select status from public.orders where id = 'a9000000-0000-0000-0000-000000000009'), 'completed', 'Когда все смены завершены, заказ завершён');

-- Прошедшие смены при перестройке не трогаются
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, status)
  select 'a8000000-0000-0000-0000-000000000008', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001',
         '51e00000-0000-0000-0000-000000000001', p.id, current_date - 2, current_date + 80, '08:00', '17:00', 2, 'accepted'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
insert into public.shifts (org_id, order_id, client_id, site_id, position_id, shift_date, start_at, end_at, headcount)
  select o.org_id, o.id, o.client_id, o.site_id, o.position_id, current_date - 2, now() - interval '50 hours', now() - interval '40 hours', 2
  from public.orders o where o.id = 'a8000000-0000-0000-0000-000000000008';
update public.orders set date_from = current_date + 79 where id = 'a8000000-0000-0000-0000-000000000008';
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select public.regenerate_order_shifts('a8000000-0000-0000-0000-000000000008', false);
select is((select count(*)::int from public.shifts where order_id = 'a8000000-0000-0000-0000-000000000008' and start_at < now()), 1,
  'Прошедшая смена при перестройке заказа осталась');

-- ------------------------------------------------------------
-- Остальные роли
-- ------------------------------------------------------------
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select ok((select count(*) from public.orders) > 5, 'Продажи видят заказы');
select throws_ok(
  $$insert into public.orders (org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount)
    select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
           current_date + 1, current_date + 2, '08:00', '17:00', 3
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик'$$,
  '42501', null, 'но не создают'
);
select throws_ok($$select public.accept_order('a4000000-0000-0000-0000-000000000004')$$, '42501', null, 'и не принимают');

set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select ok((select count(*) from public.orders) > 0 and (select count(*) = 0 from public.orders where client_id = 'c2000000-0000-0000-0000-000000000002'),
  'Заказчик видит свои заказы и не видит чужие');
select ok((select count(*) from public.shifts) > 0, 'Заказчик видит смены своих заказов');
select is((select count(*)::int from public.shift_rates), 0, 'но не ставки смен: в них ставка исполнителя');
select lives_ok(
  $$insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, source)
    select 'ab000000-0000-0000-0000-00000000000b', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001',
           '51e00000-0000-0000-0000-000000000001', p.id, current_date + 6, current_date + 6, '08:00', '17:00', 5, 'cabinet'
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик'$$,
  'Заказчик оформляет заказ из кабинета'
);
select throws_ok(
  $$insert into public.orders (org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, source)
    select private.default_org_id(), 'c2000000-0000-0000-0000-000000000002', '51e00000-0000-0000-0000-000000000003', p.id,
           current_date + 6, current_date + 6, '08:00', '17:00', 5, 'cabinet'
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик'$$,
  '42501', null, 'Заказ за чужую компанию из кабинета не создать'
);
select throws_ok(
  $$insert into public.orders (org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, source, status)
    select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', '51e00000-0000-0000-0000-000000000001', p.id,
           current_date + 6, current_date + 6, '08:00', '17:00', 5, 'cabinet', 'accepted'
    from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик'$$,
  '42501', null, 'Принятым заказ из кабинета завести нельзя'
);
select is(pg_temp.rows_changed($$update public.orders set headcount = 99 where id = 'a1000000-0000-0000-0000-000000000001'$$), 0, 'Принятый заказ заказчик не правит');
select is(pg_temp.rows_changed($$update public.orders set headcount = 6 where id = 'ab000000-0000-0000-0000-00000000000b'$$), 1, 'Свой новый заказ — правит');

set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
select is((select count(*)::int from public.orders), 0, 'Администратор другой организации заказов не видит');

reset role;
select ok(
  exists (select 1 from public.audit_log where table_name = 'orders' and record_id = 'a1000000-0000-0000-0000-000000000001' and field = 'status' and new_value = 'accepted'),
  'Принятие заказа записано в журнал'
);

select * from finish();
rollback;
