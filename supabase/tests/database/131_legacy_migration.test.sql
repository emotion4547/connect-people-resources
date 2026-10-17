-- Шаг 13: перенос заявок и откликов прежней схемы в заказы, смены и назначения.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(25);

create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;

insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-0000000000a1', 'hr1@test.local'),
  ('a2000000-0000-0000-0000-0000000000a2', 'hr2@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 3) i;
update public.user_roles set role = 'hr' where user_id = 'a1000000-0000-0000-0000-0000000000a1';
update public.profiles set company = 'ООО Ромашка', full_name = 'Анна' where user_id = 'a1000000-0000-0000-0000-0000000000a1';

-- HR-пользователь становится заказчиком (шаг 4)
select is(private.migrate_hr_to_clients(), 1, 'HR с компанией стал заказчиком');
create temp table cl as select client_id as id from public.client_contacts where user_id = 'a1000000-0000-0000-0000-0000000000a1';

-- Утверждённый тариф есть только на «Грузчик»
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), (select id from cl), p.id, 450, 300, current_date - 30, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';

-- Прежние данные: объект без заказчика, заявки и отклики
insert into public.sites (id, name, address) values ('51e00000-0000-0000-0000-000000000001', 'Склад Ромашки', 'Оренбург, ул. Складская, 1');
insert into public.site_managers (site_id, hr_user_id) values ('51e00000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000a1');

insert into public.requests (id, hr_id, site_id, position, start_date, end_date, start_time, end_time, address, quantity, pay, comments, status) values
  ('e1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-0000000000a1', '51e00000-0000-0000-0000-000000000001', 'Грузчик',
   current_date + 3, current_date + 5, '08:00', '17:00', 'Оренбург, ул. Складская, 1', 2, '300 руб/час', 'Нужны перчатки', 'assigned'),
  ('e2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-0000000000a1', '51e00000-0000-0000-0000-000000000001', 'Сортировщик',
   current_date + 4, current_date + 4, '09:00', '18:00', 'Оренбург, ул. Складская, 1', 1, NULL, NULL, 'new'),
  ('e3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-0000000000a1', '51e00000-0000-0000-0000-000000000001', 'Грузчик',
   current_date - 10, current_date - 9, '08:00', '17:00', 'Оренбург, ул. Складская, 1', 1, NULL, NULL, 'completed'),
  ('e4000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-0000000000a1', '51e00000-0000-0000-0000-000000000001', 'Грузчик',
   current_date + 8, current_date + 8, '08:00', '17:00', 'Оренбург, ул. Складская, 1', 1, NULL, NULL, 'cancelled'),
  ('e5000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-0000000000a2', NULL, 'Грузчик',
   current_date + 2, current_date + 2, '08:00', '17:00', 'Где-то', 1, NULL, NULL, 'new'),
  ('e6000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-0000000000a1', NULL, 'Монтажник',
   current_date - 3, current_date - 3, NULL, NULL, 'Оренбург, ул. Новая, 5', 3, NULL, NULL, 'new');
insert into public.responses (request_id, worker_id, status) values
  ('e1000000-0000-0000-0000-000000000001', pg_temp.w(1), 'assigned'),
  ('e1000000-0000-0000-0000-000000000001', pg_temp.w(2), 'pending'),
  ('e1000000-0000-0000-0000-000000000001', pg_temp.w(3), 'rejected'),
  ('e3000000-0000-0000-0000-000000000003', pg_temp.w(1), 'completed');

select is((select count(*)::int from public.sites where client_id is null), 1, 'До переноса есть объект без заказчика');

create temp table res as select * from private.migrate_legacy_requests();
select is((select cnt from res where entity = 'request' and result = 'migrated'), 1, 'Перенесена одна активная заявка со сменами');
select is((select cnt from res where entity = 'request' and result = 'awaiting_tariff'), 1, 'Одна ждёт тарифа');
select is((select cnt from res where entity = 'request' and result = 'archived'), 3, 'Три ушли в архив: завершённая, отменённая и прошедшая');
select is((select cnt from res where entity = 'request' and result = 'skipped'), 1, 'Одна не перенесена: у автора нет заказчика');
select is((select count(*)::int from public.sites where client_id is null), 0, 'Объект получил заказчика');
select is((select client_id from public.sites where id = '51e00000-0000-0000-0000-000000000001'), (select id from cl), 'именно своего');

select is((select status from public.orders where legacy_request_id = 'e1000000-0000-0000-0000-000000000001'), 'accepted', 'Активная заявка стала принятым заказом');
select is((select count(*)::int from public.shifts s join public.orders o on o.id = s.order_id where o.legacy_request_id = 'e1000000-0000-0000-0000-000000000001'), 3, 'со сменами по каждому дню');
select ok((select comment from public.orders where legacy_request_id = 'e1000000-0000-0000-0000-000000000001') like '%Оплата в прежней заявке: 300 руб/час%', 'Оплата текстом сохранена подсказкой в комментарии');
select is((select status from public.orders where legacy_request_id = 'e2000000-0000-0000-0000-000000000002'), 'new', 'Заявка без тарифа стала новым заказом');
select is((select count(*)::int from public.shifts s join public.orders o on o.id = s.order_id where o.legacy_request_id = 'e2000000-0000-0000-0000-000000000002'), 0, 'без смен');
select is((select status from public.orders where legacy_request_id = 'e3000000-0000-0000-0000-000000000003'), 'completed', 'Завершённая — в архив');
select is((select status from public.orders where legacy_request_id = 'e4000000-0000-0000-0000-000000000004'), 'cancelled', 'Отменённая — отменена');
select is((select status from public.orders where legacy_request_id = 'e6000000-0000-0000-0000-000000000006'), 'completed', 'Прошедшая «новая» заявка — в архив');
select is((select count(*)::int from public.orders where legacy_request_id = 'e5000000-0000-0000-0000-000000000005'), 0, 'Заявка без заказчика заказа не создала');
select is((select count(*)::int from public.positions where name = 'Монтажник'), 1, 'Прежней «другой» позиции заведена запись в справочнике');
select is((select count(*)::int from public.sites where address = 'Оренбург, ул. Новая, 5' and client_id = (select id from cl)), 1, 'Для заявки без объекта заведён объект по адресу');

select is((select count(*)::int from public.assignments a join public.shifts s on s.id = a.shift_id join public.orders o on o.id = s.order_id
           where o.legacy_request_id = 'e1000000-0000-0000-0000-000000000001' and a.worker_id = pg_temp.w(1) and a.status = 'assigned'), 3,
          'Назначенный на заявку назначен на каждую будущую смену');
select is((select count(*)::int from public.assignments a join public.shifts s on s.id = a.shift_id join public.orders o on o.id = s.order_id
           where o.legacy_request_id = 'e1000000-0000-0000-0000-000000000001' and a.worker_id = pg_temp.w(2) and a.status = 'responded'), 3, 'Откликнувшийся — отклик на каждую');
select is((select count(*)::int from public.assignments where worker_id = pg_temp.w(3)), 0, 'Отклонённый отклик не переносится');

-- Повторный запуск ничего не дублирует
select private.migrate_legacy_requests();
select is((select count(*)::int from public.orders where legacy_request_id is not null), 5, 'Повторный запуск не плодит заказы');

-- Сверка
select is((select ok::text from private.legacy_migration_report() where item = 'Заявки → заказы'), 'true', 'Сверка: заявок до и после сходится с учётом пропущенных');
select is((select after_count from private.legacy_migration_report() where item = 'Объекты без заказчика'), 0::bigint, 'Сверка: объектов без заказчика не осталось');

select * from finish();
rollback;
