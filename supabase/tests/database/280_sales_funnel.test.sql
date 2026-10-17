-- Шаг 27: воронка продаж.
-- Приёмка из ТЗ (раздел 18): выигранная сделка создаёт тарифы из КП без повторного ввода.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(43);

insert into auth.users (id, email) values
  ('d1000000-0000-0000-0000-00000000000d', 'd@test.local'),
  ('ac000000-0000-0000-0000-0000000000ac', 'acc@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local'),
  ('51000000-0000-0000-0000-000000000002', 's2@test.local');
update public.user_roles set role = 'director' where user_id = 'd1000000-0000-0000-0000-00000000000d';
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'sales' where user_id in ('51000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000002');
insert into public.staff_profiles (user_id, full_name, department) values
  ('d1000000-0000-0000-0000-00000000000d', 'Директор', 'management'),
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец 1', 'sales'),
  ('51000000-0000-0000-0000-000000000002', 'Продавец 2', 'sales');

-- Лиды с сайта распределяются по очереди
insert into public.contact_messages (name, email, phone, subject, message) values
  ('Анна', 'a@x.ru', '+79000000001', 'Нужны грузчики', 'Склад, 5 человек'),
  ('Борис', 'b@x.ru', '+79000000002', 'Нужны фасовщики', 'Фасовка'),
  ('Вера', 'v@x.ru', '+79000000003', 'Нужны уборщики', 'Уборка');
select is((select count(*)::int from public.deals where source = 'site_form'), 3, 'Три обращения с сайта — три сделки');
select is((select count(distinct owner_id)::int from public.deals where source = 'site_form'), 2, 'Лиды раздаются обоим менеджерам продаж');
select is((select count(*)::int from public.deals where owner_id = '51000000-0000-0000-0000-000000000001'), 2, 'По очереди: первому, второму, снова первому');
select is((select count(*)::int from public.notifications where user_id = '51000000-0000-0000-0000-000000000001' and event = 'deal_assigned'), 2, 'Менеджер получил уведомления о новых сделках');

-- Саморегистрация HR создаёт заказчика-лида и сделку
insert into auth.users (id, email, raw_user_meta_data) values ('b0000000-0000-0000-0000-0000000000b0', 'hr@firma.ru', '{"role":"hr","full_name":"Игорь","company":"Фирма"}');
select is((select count(*)::int from public.deals where source = 'self_registration'), 1, 'Саморегистрация HR создала сделку');
select is((select client_id is not null from public.deals where source = 'self_registration'), true, 'и она привязана к заказчику-лиду');
select is((select c.sales_manager_id is not null from public.clients c join public.deals d on d.client_id = c.id where d.source = 'self_registration'), true, 'а заказчику назначен менеджер продаж');

-- Ручное распределение: лид остаётся без ответственного
insert into public.org_settings (org_id, key, value) values (private.default_org_id(), 'sales.lead_distribution', '"manual"');
insert into public.contact_messages (name, email, subject, message) values ('Глеб', 'g@x.ru', 'Ручной лид', 'Текст');
select is((select owner_id from public.deals where title = 'Ручной лид'), null, 'При ручном распределении лид без ответственного');

-- Права на сделки
set local role authenticated;
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.deals), 1, 'Менеджер видит только свои сделки (одна)');
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
select is((select count(*)::int from public.deals), 0, 'Бухгалтер сделок не видит');
select throws_ok($$select * from public.deal_funnel(private.default_org_id())$$, '42501', null, 'и воронку тоже');
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
select is((select count(*)::int from public.deals), 5, 'Руководитель видит все сделки');

-- Создание сделки менеджером
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select lives_ok($$insert into public.deals (org_id, title, company, contact_name, owner_id, expected_revenue, expected_margin)
  values (private.default_org_id(), 'Логистика-Плюс', 'Логистика-Плюс', 'Сергей', '51000000-0000-0000-0000-000000000001', 300000, 60000)$$, 'Менеджер заводит сделку на себя');
select throws_ok($$insert into public.deals (org_id, title, owner_id, stage) values (private.default_org_id(), 'Сразу выиграна', '51000000-0000-0000-0000-000000000001', 'won')$$, '42501', null, 'но не может завести её сразу выигранной');
select throws_ok($$insert into public.deals (org_id, title, owner_id) values (private.default_org_id(), 'Чужая', '51000000-0000-0000-0000-000000000002')$$, '42501', null, 'и не может завести сделку на коллегу');

create temp table dl as select id from public.deals where title = 'Логистика-Плюс';
grant select on dl to authenticated;

-- Этапы
select throws_ok($$select public.set_deal_stage((select id from dl), 'won')$$, '22023', null, 'Выигранной сделку делает только специальная кнопка');
select lives_ok($$select public.set_deal_stage((select id from dl), 'qualification')$$, 'Этап меняется');
select throws_ok($$select public.set_deal_stage((select id from dl), 'lost')$$, '22023', null, 'Отказ без причины невозможен');
select throws_ok($$update public.deals set stage = 'contract' where id = (select id from dl)$$, '42501', null, 'Этап напрямую не меняется');

-- Касания и «Мой день»
select public.add_deal_touch((select id from dl), 'call', 'Позвонить и уточнить потребность', now() - interval '1 day');
select public.add_deal_touch((select id from dl), 'meeting', 'Встреча на складе', now() - interval '3 days', 'прошла хорошо', true);
select is((select count(*)::int from public.my_sales_day(private.default_org_id()) where kind = 'task' and overdue), 1, 'В «Моём дне» одна просроченная задача');
reset role;
select private.notify_deal_tasks();
select private.notify_deal_tasks();
select is((select count(*)::int from public.notifications where user_id = '51000000-0000-0000-0000-000000000001' and event = 'deal_task_due' and dedup_key like 'dealtask:%'), 1, 'Напоминание о задаче приходит один раз');
set local role authenticated;
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select public.complete_deal_touch((select id from public.deal_touches where done_at is null and kind = 'call'));
select is((select count(*)::int from public.my_sales_day(private.default_org_id()) where kind = 'task'), 0, 'Выполненная задача из «Моего дня» уходит');
select is((select last_touch_at is not null from public.deals where id = (select id from dl)), true, 'У сделки отмечено последнее касание');

-- КП
select lives_ok($$select public.create_deal_quote((select id from dl),
  jsonb_build_array(jsonb_build_object('position_id', (select id from public.positions where name = 'Грузчик' limit 1), 'unit', 'hour', 'client_rate', 450, 'worker_rate', 300, 'headcount', 5, 'hours_per_month', 800)))$$, 'КП создаётся');
select throws_ok($$select public.create_deal_quote((select id from dl), '[]'::jsonb)$$, '22023', null, 'КП без позиций невозможно');
select throws_ok($$select public.create_deal_quote((select id from dl), jsonb_build_array(jsonb_build_object('position_id', gen_random_uuid(), 'client_rate', 1, 'worker_rate', 1)))$$, '22023', null, 'Позиция должна существовать');
select throws_ok($$select public.create_deal_quote((select id from dl), jsonb_build_array(jsonb_build_object('position_id', (select id from public.positions where name = 'Грузчик' limit 1), 'client_rate', 450)))$$, '22023', null, 'Ставка исполнителя обязательна');
select public.create_deal_quote((select id from dl),
  jsonb_build_array(jsonb_build_object('position_id', (select id from public.positions where name = 'Грузчик' limit 1), 'unit', 'hour', 'client_rate', 480, 'worker_rate', 310, 'headcount', 5, 'hours_per_month', 800),
                    jsonb_build_object('position_id', (select id from public.positions where name = 'Кладовщик' limit 1), 'unit', 'hour', 'client_rate', 520, 'worker_rate', 350, 'headcount', 1, 'hours_per_month', 160)),
  current_date + 14, 'Вторая версия');
select is((select max(version) from public.deal_quotes where deal_id = (select id from dl)), 2, 'Версии КП нумеруются');
select public.mark_quote_sent((select id from public.deal_quotes where deal_id = (select id from dl) and version = 2), 'client@x.ru');
select is((select stage from public.deals where id = (select id from dl)), 'proposal', 'После отправки КП сделка на этапе «КП отправлено»');

-- Выигрыш: тарифы из последнего КП
select is(public.win_deal((select id from dl)), 2, 'Выигрыш создаёт тарифы по строкам последнего КП');
select is((select status from public.clients where name = 'Логистика-Плюс'), 'contract', 'Заказчик создан и переведён в «Договор»');
select is((select client_rate from public.tariffs t join public.clients c on c.id = t.client_id where c.name = 'Логистика-Плюс' and t.position_id = (select id from public.positions where name = 'Грузчик' limit 1)), 480.00, 'Тариф взят из КП без повторного ввода');
select is((select count(*)::int from public.tariffs t join public.clients c on c.id = t.client_id where c.name = 'Логистика-Плюс' and t.status = 'draft'), 2, 'Тарифы — черновики');
select throws_ok($$select public.set_deal_stage((select id from dl), 'lost', 'Передумали')$$, '22023', null, 'Выигранную сделку изменить нельзя');

-- Лид из саморегистрации: заказчик из «лида» уходит в договор
select lives_ok($$select public.win_deal((select id from public.deals where source = 'self_registration'))$$, 'Сделку из саморегистрации можно выиграть и без КП');
select is((select c.status from public.clients c where c.name = 'Фирма'), 'contract', 'Заказчик-лид стал «Договор»');

-- Воронка и отказы
reset role;
set local role authenticated;
set local request.jwt.claim.sub = 'd1000000-0000-0000-0000-00000000000d';
update public.deals set expected_revenue = 100000 where title = 'Нужны грузчики';
select public.set_deal_stage((select id from public.deals where title = 'Нужны фасовщики'), 'lost', 'Дорого');
select public.set_deal_stage((select id from public.deals where title = 'Нужны уборщики'), 'lost', 'Дорого');
select is((select deals from public.deal_lost_reasons(private.default_org_id(), current_date - 1, current_date + 1) where reason = 'Дорого'), 2::bigint, 'Причины отказов сгруппированы: «Дорого» дважды');
select is((select weighted from public.deal_funnel(private.default_org_id()) where stage = 'new'), 10000.00, 'Взвешенная выручка этапа «Новая»: 100 000 × 10%');

-- Назначение и план продаж
select lives_ok($$select public.assign_deal((select id from public.deals where title = 'Нужны грузчики'), '51000000-0000-0000-0000-000000000002')$$, 'Руководитель передаёт сделку другому менеджеру');
select lives_ok($$select public.save_sales_plan(private.default_org_id(), '51000000-0000-0000-0000-000000000001', date_trunc('month', current_date)::date, 500000)$$, 'Руководитель ставит план продаж');
select is((select plan from public.sales_plan_fact(private.default_org_id(), current_date, current_date) where manager_id = '51000000-0000-0000-0000-000000000001'), 500000.00, 'План виден в отчёте план/факт');
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select public.save_sales_plan(private.default_org_id(), '51000000-0000-0000-0000-000000000001', date_trunc('month', current_date)::date, 1)$$, '42501', null, 'Менеджер сам себе план не меняет');
select throws_ok($$select public.assign_deal((select id from public.deals limit 1), null)$$, '42501', null, 'и сделки не распределяет');

select * from finish();
rollback;
