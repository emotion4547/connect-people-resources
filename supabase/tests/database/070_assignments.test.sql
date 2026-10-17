-- Шаг 7: назначения, проверки допуска, резерв, отклики.
-- Приёмка из ТЗ (раздел 8): массовое назначение отклоняет исполнителя из стоп-листа и исполнителя
-- с истёкшей медкнижкой, лишних ставит в резерв; сетка показывает укомплектованность.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(57);

create function pg_temp.rows_changed(_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute _sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.rows_changed(text) to authenticated;

-- Идентификаторы исполнителей: W1…W15 = 77000001…77000015.
create function pg_temp.w(i int) returns uuid language sql immutable as $$
  select (('770000' || lpad(i::text, 2, '0')) || '-0000-0000-0000-000000000000')::uuid
$$;
grant execute on function pg_temp.w(int) to authenticated;

-- Организация 1: SM — менеджер объекта, SM2 — чужой менеджер, S1 — продажи, D — руководитель,
-- CU — человек из кабинета заказчика. Исполнители W1…W15.
insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('5d000000-0000-0000-0000-0000000000d2', 'sm2@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'cu@test.local');
insert into auth.users (id, email) select pg_temp.w(i), 'w' || i || '@test.local' from generate_series(1, 16) i;
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
insert into public.sites (id, name, client_id, site_manager_id, status) values
  ('51e00000-0000-0000-0000-000000000001', 'Склад 1', 'c1000000-0000-0000-0000-000000000001', '5c000000-0000-0000-0000-0000000000c1', 'active');
insert into public.tariffs (org_id, client_id, position_id, client_rate, worker_rate, valid_from, status)
  select private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', p.id, 450, 300, current_date - 30, 'approved'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';

-- Склад 1 требует медицинскую книжку.
insert into public.site_required_documents (org_id, site_id, document_type_id)
  select private.default_org_id(), '51e00000-0000-0000-0000-000000000001', id from public.directories
  where org_id = private.default_org_id() and kind = 'document_type' and name = 'Медицинская книжка';

-- Исполнители: налоговый статус «самозанятый». У W1…W12 медкнижка действует, у W13 истекла,
-- W14 — в стоп-листе заказчика, W15 — без проблем (для проверки «мест нет»).
update public.workers set tax_status = 'self_employed' where user_id in (select pg_temp.w(i) from generate_series(1, 16) i);
insert into public.worker_documents (org_id, worker_id, document_type_id, status, valid_until)
  select private.default_org_id(), pg_temp.w(i), d.id, 'verified', case when i = 13 then current_date - 1 else current_date + 365 end
  from generate_series(1, 16) i, public.directories d
  where d.org_id = private.default_org_id() and d.kind = 'document_type' and d.name = 'Медицинская книжка';
insert into public.worker_blocks (org_id, worker_id, client_id, reason)
  values (private.default_org_id(), pg_temp.w(14), 'c1000000-0000-0000-0000-000000000001', 'Конфликт на объекте');
insert into public.worker_positions (org_id, worker_id, position_id)
  select private.default_org_id(), pg_temp.w(i), p.id from unnest(array[1, 2, 3, 4, 5, 6, 15]) i, public.positions p
  where p.org_id = private.default_org_id() and p.name = 'Грузчик';

select is((select count(*)::int from public.workers where user_id in (select pg_temp.w(i) from generate_series(1, 16) i)), 16, 'Регистрация исполнителя создаёт запись workers');

-- ------------------------------------------------------------
-- Смена на 10 человек + 2 в резерв
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, reserve_count)
  select 'a1000000-0000-0000-0000-000000000001', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001',
         '51e00000-0000-0000-0000-000000000001', p.id, current_date + 2, current_date + 2, '08:00', '17:00', 10, 2
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
select public.accept_order('a1000000-0000-0000-0000-000000000001');

create temp table mass as
  select * from public.assign_workers(
    (select array_agg(id) from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001'),
    (select array_agg(pg_temp.w(i) order by i) from generate_series(1, 14) i));

select is((select count(*)::int from mass where result = 'assigned'), 10, 'Массовое назначение: десять основных мест');
select is((select count(*)::int from mass where result = 'reserve'), 2, 'двое в резерве');
select is((select count(*)::int from mass where result = 'rejected'), 2, 'и двое отклонены');
select ok((select reason from mass where worker_id = pg_temp.w(14)) like '%стоп-лист%', 'Исполнитель из стоп-листа отклонён с причиной');
select ok((select reason from mass where worker_id = pg_temp.w(13)) like '%Медицинская книжка%', 'Исполнитель с истёкшей медкнижкой отклонён с причиной');
select is((select status from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001'), 'staffed', 'Смена укомплектована');
select is(
  (select assigned_count || '/' || reserve_count_taken || '/' || confirmed_count from public.shift_staffing where order_id = 'a1000000-0000-0000-0000-000000000001'),
  '10/2/0', 'Сетка: назначено 10, резерв 2, подтвердили 0');
select throws_ok(
  $$select public.assign_worker((select id from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001'), pg_temp.w(15))$$,
  '22023', null, 'Когда основные и резервные места заняты, назначить нельзя'
);

-- Подтверждение выхода: десять человек подтвердили — сетка 10/10
reset role;
update public.assignments set status = 'confirmed', confirmed_at = now() where not is_reserve and status = 'assigned';
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select is(
  (select confirmed_count from public.shift_staffing where order_id = 'a1000000-0000-0000-0000-000000000001'), 10,
  'После подтверждений сетка показывает 10 из 10');

-- Отмена исполнителем до срока и перевод резервиста
set local request.jwt.claim.sub = '77000001-0000-0000-0000-000000000000';
select lives_ok(
  $$select public.cancel_assignment(a.id, (select id from public.directories where org_id = private.default_org_id() and kind = 'cancel_reason' and name = 'Изменились планы'))
    from public.assignments a where a.worker_id = pg_temp.w(1)$$,
  'Исполнитель отменяет сам, пока до смены больше 12 часов'
);
select is((select status from public.assignments where worker_id = pg_temp.w(1)), 'cancelled_worker', 'Назначение отменено исполнителем');
select is((select late_cancel from public.assignments where worker_id = pg_temp.w(1)), false, 'Отмена не поздняя');
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select is((select status from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001'), 'open', 'Освободилось место: смена снова открыта');
select lives_ok(
  $$select public.promote_reserve(a.id) from public.assignments a
    where a.shift_id in (select id from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001') and a.is_reserve limit 1$$,
  'Резервист переводится в основной состав одним действием'
);
select is((select status from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001'), 'staffed', 'Смена снова укомплектована');
select throws_ok(
  $$select public.promote_reserve(a.id) from public.assignments a
    where a.shift_id in (select id from public.shifts where order_id = 'a1000000-0000-0000-0000-000000000001') and a.is_reserve limit 1$$,
  '22023', null, 'Пока основные места заняты, ещё одного резервиста не перевести'
);

-- ------------------------------------------------------------
-- Проверки допуска
-- ------------------------------------------------------------
-- Пересечение и предупреждения
reset role;
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, status)
  select 'a2000000-0000-0000-0000-000000000002', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001',
         '51e00000-0000-0000-0000-000000000001', p.id, current_date + 2, current_date + 2, '12:00', '14:00', 5, 'new'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, status)
  select 'a3000000-0000-0000-0000-000000000003', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001',
         '51e00000-0000-0000-0000-000000000001', p.id, current_date + 2, current_date + 2, '20:00', '23:00', 5, 'new'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select public.accept_order('a2000000-0000-0000-0000-000000000002');
select public.accept_order('a3000000-0000-0000-0000-000000000003');

select throws_ok(
  $$select public.assign_worker((select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), pg_temp.w(2))$$,
  '22023', null, 'Исполнитель с действующей сменой в это время не назначается'
);
select ok(
  exists (select 1 from public.check_assignment((select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), pg_temp.w(2)) where code = 'overlap' and severity = 'deny'),
  'Проверка называет пересечение запретом'
);
select ok(
  (public.assign_worker((select id from public.shifts where order_id = 'a3000000-0000-0000-0000-000000000003'), pg_temp.w(2)) -> 'warnings')::text like '%Отдых%',
  'Отдых после предыдущей смены меньше 8 часов: предупреждение, но назначение проходит'
);
select ok(
  (select count(*) = 1 from public.check_assignment((select id from public.shifts where order_id = 'a3000000-0000-0000-0000-000000000003'), pg_temp.w(8)) where code = 'position_experience'),
  'Исполнитель без опыта по позиции: предупреждение'
);
reset role;
select throws_ok(
  $$insert into public.assignments (org_id, shift_id, worker_id, status, shift_start, shift_end)
    select private.default_org_id(), s.id, pg_temp.w(3), 'assigned', s.start_at, s.end_at from public.shifts s where s.order_id = 'a2000000-0000-0000-0000-000000000002'$$,
  '23P01', null, 'База сама запрещает пересечение, даже если обойти проверку'
);

-- Налоговый статус, статус исполнителя, договор
update public.workers set tax_status = null where user_id = pg_temp.w(9);
update public.workers set status = 'sick', status_until = current_date + 10 where user_id = pg_temp.w(10);
update public.workers set status = 'sick', status_until = current_date - 1 where user_id = pg_temp.w(16);
update public.workers set contract_valid_until = current_date where user_id = pg_temp.w(12);
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select ok(exists (select 1 from public.check_assignment((select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), pg_temp.w(9)) where code = 'tax_status_missing'),
  'Без налогового статуса назначить нельзя');
select ok(exists (select 1 from public.check_assignment((select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), pg_temp.w(10)) where code = 'worker_status'),
  'На больничном до будущей даты назначить нельзя');
select ok(not exists (select 1 from public.check_assignment((select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), pg_temp.w(16)) where severity = 'deny'),
  'Больничный закончился вчера: исполнитель снова доступен');
select ok(exists (select 1 from public.check_assignment((select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), pg_temp.w(12)) where code = 'contract_expired'),
  'Договор истёк к дате смены: назначить нельзя');
reset role;
insert into public.org_settings (org_id, key, value) values (private.default_org_id(), 'workers.allowed_tax_statuses', '["ip"]');
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select ok(exists (select 1 from public.check_assignment((select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), pg_temp.w(4)) where code = 'tax_status_not_allowed'),
  'Налоговый статус, не разрешённый организацией, отклоняется');
reset role;
delete from public.org_settings where key = 'workers.allowed_tax_statuses';
set local role authenticated;
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';

-- ------------------------------------------------------------
-- Поздняя отмена, неявка
-- ------------------------------------------------------------
reset role;
insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, status)
  select 'a4000000-0000-0000-0000-000000000004', private.default_org_id(), 'c1000000-0000-0000-0000-000000000001',
         '51e00000-0000-0000-0000-000000000001', p.id, current_date, current_date, '08:00', '17:00', 5, 'accepted'
  from public.positions p where p.org_id = private.default_org_id() and p.name = 'Грузчик';
insert into public.shifts (id, org_id, order_id, client_id, site_id, position_id, shift_date, start_at, end_at, headcount)
  select 'b1000000-0000-0000-0000-000000000001', o.org_id, o.id, o.client_id, o.site_id, o.position_id, current_date, now() + interval '3 hours', now() + interval '8 hours', 5
  from public.orders o where o.id = 'a4000000-0000-0000-0000-000000000004';
insert into public.shifts (id, org_id, order_id, client_id, site_id, position_id, shift_date, start_at, end_at, headcount)
  select 'b2000000-0000-0000-0000-000000000002', o.org_id, o.id, o.client_id, o.site_id, o.position_id, current_date - 5, now() - interval '5 days 1 hour', now() - interval '4 days 20 hours', 5
  from public.orders o where o.id = 'a4000000-0000-0000-0000-000000000004';
insert into public.assignments (org_id, shift_id, worker_id, status, shift_start, shift_end) values
  (private.default_org_id(), 'b1000000-0000-0000-0000-000000000001', pg_temp.w(5), 'assigned', now() + interval '3 hours', now() + interval '8 hours'),
  (private.default_org_id(), 'b1000000-0000-0000-0000-000000000001', pg_temp.w(6), 'assigned', now() + interval '3 hours', now() + interval '8 hours'),
  (private.default_org_id(), 'b2000000-0000-0000-0000-000000000002', pg_temp.w(7), 'assigned', now() - interval '5 days 1 hour', now() - interval '4 days 20 hours');

set local role authenticated;
set local request.jwt.claim.sub = '77000005-0000-0000-0000-000000000000';
select throws_ok(
  $$select public.cancel_assignment(a.id, (select id from public.directories where org_id = private.default_org_id() and kind = 'cancel_reason' limit 1))
    from public.assignments a where a.worker_id = pg_temp.w(5) and a.shift_id = 'b1000000-0000-0000-0000-000000000001'$$,
  '22023', null, 'Позже чем за 12 часов исполнитель сам отменить не может'
);
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select lives_ok(
  $$select public.cancel_assignment(a.id, (select id from public.directories where org_id = private.default_org_id() and kind = 'cancel_reason' limit 1), true)
    from public.assignments a where a.worker_id = pg_temp.w(5) and a.shift_id = 'b1000000-0000-0000-0000-000000000001'$$,
  'Менеджер оформляет отмену за исполнителя'
);
select is((select status || ':' || late_cancel from public.assignments where worker_id = pg_temp.w(5) and shift_id = 'b1000000-0000-0000-0000-000000000001'),
  'cancelled_worker:true', 'Отмена записана как поздняя и влияет на рейтинг');
select lives_ok(
  $$select public.cancel_assignment(a.id, (select id from public.directories where org_id = private.default_org_id() and kind = 'cancel_reason' limit 1), false)
    from public.assignments a where a.worker_id = pg_temp.w(6) and a.shift_id = 'b1000000-0000-0000-0000-000000000001'$$,
  'Менеджер снимает исполнителя сам'
);
select is((select status || ':' || late_cancel from public.assignments where worker_id = pg_temp.w(6) and shift_id = 'b1000000-0000-0000-0000-000000000001'),
  'cancelled_manager:false', 'Это отмена менеджера, а не поздняя отмена исполнителя');
select throws_ok(
  $$select public.cancel_assignment(a.id, null) from public.assignments a where a.worker_id = pg_temp.w(2) and a.shift_id in (select id from public.shifts where order_id = 'a3000000-0000-0000-0000-000000000003')$$,
  '22023', null, 'Отмена без причины из справочника отклоняется'
);
select lives_ok(
  $$select public.mark_no_show(a.id, (select id from public.directories where org_id = private.default_org_id() and kind = 'no_show_reason' limit 1))
    from public.assignments a where a.worker_id = pg_temp.w(7) and a.shift_id = 'b2000000-0000-0000-0000-000000000002'$$,
  'Неявка отмечается с причиной'
);
select is((select status from public.assignments where worker_id = pg_temp.w(7) and shift_id = 'b2000000-0000-0000-0000-000000000002'), 'no_show', 'Статус «Не вышел»');
select throws_ok(
  $$select public.mark_no_show(a.id, (select id from public.directories where org_id = private.default_org_id() and kind = 'no_show_reason' limit 1))
    from public.assignments a where a.worker_id = pg_temp.w(2) and a.shift_id in (select id from public.shifts where order_id = 'a3000000-0000-0000-0000-000000000003')$$,
  '22023', null, 'Неявку у ещё не начавшейся смены отметить нельзя'
);

-- Поиск исполнителя
select is((select can_assign from public.find_workers((select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), 'w14@test')), false,
  'Поиск: исполнитель из стоп-листа помечен как недоступный');
select ok((select problems from public.find_workers((select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), 'w14@test') limit 1) like '%стоп-лист%',
  'и поиск называет причину');
select is((select free from public.find_workers((select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), 'w2@test') limit 1), false,
  'Поиск: занятый в это время исполнитель не свободен');
select is((select no_shows_90d from public.find_workers((select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), 'w7@test') limit 1), 1,
  'Поиск показывает неявки за 90 дней');

-- ------------------------------------------------------------
-- Отклики
-- ------------------------------------------------------------
set local request.jwt.claim.sub = '77000015-0000-0000-0000-000000000000';
select is(public.respond_to_shifts(array[(select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002')]), 1, 'Исполнитель откликается на смену своей позиции');
select is(public.respond_to_shifts(array[(select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002')]), 0, 'Повторный отклик ничего не дублирует');
set local request.jwt.claim.sub = '77000006-0000-0000-0000-000000000000';
select is(public.respond_to_shifts(array[(select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002')]), 1, 'Ещё один отклик');
select is((select count(*)::int from public.assignments where status = 'responded'), 1, 'Исполнитель видит только свои отклики');
set local request.jwt.claim.sub = '77000014-0000-0000-0000-000000000000';
select is(public.respond_to_shifts(array[(select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002')]), 0, 'Исполнитель без позиции откликнуться не может (W14 не указал «Грузчик»)');

set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select is((select count(*)::int from public.review_responses(
  (select array_agg(id) from public.assignments where status = 'responded' and worker_id = pg_temp.w(15)), true) where result = 'assigned'), 1,
  'Менеджер принимает отклик');
select is((select count(*)::int from public.review_responses(
  (select array_agg(id) from public.assignments where status = 'responded' and worker_id = pg_temp.w(6)), false) where result = 'rejected'), 1,
  'или отклоняет');

-- ------------------------------------------------------------
-- Права
-- ------------------------------------------------------------
set local request.jwt.claim.sub = '5d000000-0000-0000-0000-0000000000d2';
select throws_ok($$select public.assign_worker((select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), pg_temp.w(10))$$,
  '42501', null, 'Чужой менеджер объекта назначать не может');
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select public.assign_worker((select id from public.shifts where order_id = 'a2000000-0000-0000-0000-000000000002'), pg_temp.w(10))$$,
  '42501', null, 'Продажи назначать не могут');
select is((select count(*)::int from public.assignments), 0, 'и не видят назначений');
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select is((select count(*)::int from public.assignments), 0, 'Кабинет заказчика назначений напрямую не видит');
set local request.jwt.claim.sub = '77000002-0000-0000-0000-000000000000';
select ok((select count(*) from public.assignments) > 0 and (select count(*) = 0 from public.assignments where worker_id <> pg_temp.w(2)),
  'Исполнитель видит только свои назначения');
select is((select count(*)::int from public.shift_rates), 0, 'и не видит ставки смен');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select ok((select count(*) from public.assignments) > 5, 'Руководитель видит все назначения');

-- Повтор недели с назначениями
set local request.jwt.claim.sub = '5c000000-0000-0000-0000-0000000000c1';
select lives_ok($$select public.repeat_order_week('a1000000-0000-0000-0000-000000000001', true)$$, 'Повтор недели с назначениями');
select ok(
  (select count(*) > 0 and bool_and(a.status = 'invited') from public.assignments a join public.shifts s on s.id = a.shift_id
    where s.shift_date = current_date + 9),
  'Исполнители получают приглашения на следующую неделю'
);
reset role;
select ok(exists (select 1 from public.audit_log where table_name = 'assignments' and field = 'status' and new_value = 'cancelled_worker'),
  'Отмены записаны в журнал');

select * from finish();
rollback;
