-- Шаг 2: настройки с датой вступления в силу и налоговые ставки.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(32);

create function pg_temp.rows_changed(_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute _sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.rows_changed(text) to authenticated;

-- Организация 1 (по умолчанию): A — администратор, C — hr. Организация 2: B — администратор.
insert into public.organizations (id, name) values ('b2000000-0000-0000-0000-000000000002', 'Вторая организация');
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'a@test.local'),
  ('b0000000-0000-0000-0000-00000000000b', 'b@test.local'),
  ('c0000000-0000-0000-0000-00000000000c', 'c@test.local');
update public.user_roles set role = 'admin' where user_id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');
update public.user_roles set role = 'hr' where user_id = 'c0000000-0000-0000-0000-00000000000c';
update public.user_roles set org_id = 'b2000000-0000-0000-0000-000000000002' where user_id = 'b0000000-0000-0000-0000-00000000000b';

-- ------------------------------------------------------------
-- Каталог и значения по умолчанию
-- ------------------------------------------------------------
select is(
  public.get_setting(private.default_org_id(), 'timesheet.autoconfirm_hours'), '48'::jsonb,
  'Без переопределений действует значение по умолчанию из ТЗ (48 ч)'
);
select is(public.get_setting(private.default_org_id(), 'tariff.min_margin_pct'), '20'::jsonb, 'Порог маржи по умолчанию — 20%');
select is(public.get_setting(private.default_org_id(), 'notify.worker_reminder_time'), '"18:00"'::jsonb, 'Напоминание накануне — 18:00');
select ok(
  (select bool_and(needs_confirmation) from public.setting_definitions where key in ('tariff.min_margin_pct', 'cancel.worker_free_hours', 'rating.penalty_no_show')),
  'Значения из открытых вопросов помечены «требует подтверждения»'
);

-- ------------------------------------------------------------
-- Администратор организации 1
-- ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';

select lives_ok(
  $$insert into public.org_settings (org_id, key, value) values (private.default_org_id(), 'timesheet.autoconfirm_hours', '72')$$,
  'Администратор меняет настройку организации'
);
select is(public.get_setting(private.default_org_id(), 'timesheet.autoconfirm_hours'), '72'::jsonb, 'Новое значение действует с сегодняшнего дня');

select lives_ok(
  $$insert into public.org_settings (org_id, key, value, effective_from)
    values (private.default_org_id(), 'timesheet.autoconfirm_hours', '96', current_date + 10)$$,
  'Можно запланировать значение на будущее'
);
select is(public.get_setting(private.default_org_id(), 'timesheet.autoconfirm_hours'), '72'::jsonb, 'До даты вступления действует прежнее значение');
select is(public.get_setting(private.default_org_id(), 'timesheet.autoconfirm_hours', current_date + 10), '96'::jsonb,
  'С даты вступления действует новое');

select lives_ok(
  $$insert into public.org_settings (org_id, key, value, scope_type, scope_id)
    values (private.default_org_id(), 'timesheet.autoconfirm_hours', '24', 'client', 'c1000000-0000-0000-0000-000000000001')$$,
  'Заказчик может переопределить срок автоподтверждения'
);
select is(
  public.get_setting(private.default_org_id(), 'timesheet.autoconfirm_hours', current_date, 'c1000000-0000-0000-0000-000000000001'),
  '24'::jsonb, 'Значение заказчика важнее значения организации'
);
select is(
  public.get_setting(private.default_org_id(), 'timesheet.autoconfirm_hours', current_date, 'c2000000-0000-0000-0000-000000000002'),
  '72'::jsonb, 'У другого заказчика действует значение организации'
);

-- Проверки значений
select throws_ok(
  $$insert into public.org_settings (org_id, key, value, effective_from)
    values (private.default_org_id(), 'timesheet.autoconfirm_hours', '10', current_date - 1)$$,
  '22023', null, 'Задним числом менять нельзя'
);
select throws_ok(
  $$insert into public.org_settings (org_id, key, value) values (private.default_org_id(), 'no.such.key', '1')$$,
  '23503', null, 'Неизвестная настройка отклоняется'
);
select throws_ok(
  $$insert into public.org_settings (org_id, key, value) values (private.default_org_id(), 'timesheet.autoconfirm_hours', '"много"')$$,
  '22023', null, 'Текст вместо числа отклоняется'
);
select throws_ok(
  $$insert into public.org_settings (org_id, key, value) values (private.default_org_id(), 'checkin.geo_radius_m', '1')$$,
  '22023', null, 'Значение вне допустимого диапазона отклоняется'
);
select throws_ok(
  $$insert into public.org_settings (org_id, key, value) values (private.default_org_id(), 'notify.worker_reminder_time', '"25:00"')$$,
  '22023', null, 'Неверное время отклоняется'
);
select throws_ok(
  $$insert into public.org_settings (org_id, key, value, scope_type, scope_id)
    values (private.default_org_id(), 'tariff.min_margin_pct', '10', 'site', 'e1000000-0000-0000-0000-000000000001')$$,
  '22023', null, 'Настройку нельзя задать на неподходящем уровне'
);

-- Прошлое не меняется: UPDATE запрещён, удалить можно только не вступившее в силу
select throws_ok($$update public.org_settings set value = '1'$$, '42501', null, 'Записи настроек нельзя править');
select is(pg_temp.rows_changed($$delete from public.org_settings where effective_from > current_date$$), 1,
  'Ошибочную запись на будущее можно удалить');
select is(pg_temp.rows_changed($$delete from public.org_settings where effective_from <= current_date$$), 0,
  'Действующие записи удалить нельзя');

select ok(
  exists (select 1 from public.audit_log where table_name = 'org_settings' and action = 'insert'
          and actor_id = 'a0000000-0000-0000-0000-00000000000a'),
  'Изменения настроек записываются в журнал'
);

-- Налоговые ставки: стартовые значения и версии
select is((select ndfl_pct from public.get_tax_rate(private.default_org_id(), 'gph')), 13.00, 'ГПХ: НДФЛ 13% из примера ТЗ');
select is((select payout_fee_pct from public.get_tax_rate(private.default_org_id(), 'self_employed')), 2.00, 'Самозанятый: комиссия 2%');
select is((select confirmed from public.get_tax_rate(private.default_org_id(), 'gph')), false, 'Ставки не подтверждены бухгалтерией');

select lives_ok(
  $$insert into public.tax_status_rates (org_id, status, ndfl_pct, contributions_pct, effective_from, confirmed)
    values (private.default_org_id(), 'gph', 15, 30, current_date + 5, true)$$,
  'Бухгалтерия заводит новую ставку на будущее'
);
select is((select ndfl_pct from public.get_tax_rate(private.default_org_id(), 'gph')), 13.00, 'До даты вступления действует прежняя ставка');
select is((select ndfl_pct from public.get_tax_rate(private.default_org_id(), 'gph', current_date + 5)), 15.00, 'С даты вступления — новая');

select public.create_organization('Организация со стартовыми ставками');
select is(
  (select count(*)::int from public.tax_status_rates r join public.organizations o on o.id = r.org_id
    where o.name = 'Организация со стартовыми ставками'),
  4, 'Новая организация получает стартовые ставки по четырём статусам'
);

-- ------------------------------------------------------------
-- Чужая организация и не администратор
-- ------------------------------------------------------------
set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
select is((select count(*)::int from public.org_settings where org_id = private.default_org_id()), 0,
  'Администратор другой организации не видит настройки');
select throws_ok(
  $$insert into public.org_settings (org_id, key, value) values (private.default_org_id(), 'timesheet.autoconfirm_hours', '1')$$,
  '42501', null, 'И не может записать в чужую организацию'
);

set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select throws_ok(
  $$insert into public.org_settings (org_id, key, value) values (private.default_org_id(), 'timesheet.autoconfirm_hours', '1')$$,
  '42501', null, 'Не администратор не меняет настройки'
);

select * from finish();
rollback;
