-- Доработки после этапа 3: счета денег правятся из интерфейса, выигрыш сделки уведомляет менеджеров объектов.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(10);

insert into auth.users (id, email) values
  ('ac000000-0000-0000-0000-0000000000ac', 'acc@test.local'),
  ('5c000000-0000-0000-0000-0000000000c1', 'sm@test.local'),
  ('51000000-0000-0000-0000-000000000001', 's1@test.local');
update public.user_roles set role = 'accountant' where user_id = 'ac000000-0000-0000-0000-0000000000ac';
update public.user_roles set role = 'site_manager' where user_id = '5c000000-0000-0000-0000-0000000000c1';
update public.user_roles set role = 'sales' where user_id = '51000000-0000-0000-0000-000000000001';
insert into public.staff_profiles (user_id, full_name, department) values
  ('ac000000-0000-0000-0000-0000000000ac', 'Бухгалтер', 'accounting'),
  ('5c000000-0000-0000-0000-0000000000c1', 'Менеджер объектов', 'sites'),
  ('51000000-0000-0000-0000-000000000001', 'Продавец', 'sales');

set local role authenticated;
set local request.jwt.claim.sub = 'ac000000-0000-0000-0000-0000000000ac';
create temp table acc as select public.save_cash_account(private.default_org_id(), null, 'bank', 'Т-Банк', 'Т-Банк', '40702810000000000001', 250000, current_date - 30) as id;
grant select on acc to authenticated;
select is((select opening_balance from public.cash_accounts where id = (select id from acc)), 250000.00, 'Счёт создан с остатком');
select is((select balance from public.cash_balances(private.default_org_id(), current_date) where account_id = (select id from acc)), 250000.00, 'и остаток виден в остатках денег');
select lives_ok($$select public.save_cash_account(private.default_org_id(), (select id from acc), 'bank', 'Т-Банк основной', 'Т-Банк', '40702810000000000001', 300000, current_date - 30)$$, 'Счёт правится');
select is((select name from public.cash_accounts where id = (select id from acc)), 'Т-Банк основной', 'название обновилось');
select lives_ok($$select public.save_cash_account(private.default_org_id(), (select id from acc), 'bank', 'Т-Банк основной', 'Т-Банк', '40702810000000000001', 300000, current_date - 30, false)$$, 'Счёт можно выключить');
select is((select is_active from public.cash_accounts where id = (select id from acc)), false, 'и он выключен');
select throws_ok($$select public.save_cash_account(private.default_org_id(), null, 'safe', 'Сейф', null, null, 0, current_date)$$, '22023', null, 'Неизвестный вид счёта отвергается');
set local request.jwt.claim.sub = '51000000-0000-0000-0000-000000000001';
select throws_ok($$select public.save_cash_account(private.default_org_id(), null, 'cash', 'Касса 2', null, null, 0, current_date)$$, '42501', null, 'Продавец счета не заводит');

-- Выигрыш сделки уведомляет менеджера объектов
insert into public.deals (org_id, title, company, owner_id) values (private.default_org_id(), 'Новая сделка', 'Фабрика', '51000000-0000-0000-0000-000000000001');
select public.win_deal((select id from public.deals where title = 'Новая сделка'));
reset role;
select is((select count(*)::int from public.notifications where user_id = '5c000000-0000-0000-0000-0000000000c1' and event = 'client_handoff'), 1, 'Менеджер объектов получил уведомление о новом заказчике');
select is((select count(*)::int from public.notifications where user_id = '51000000-0000-0000-0000-000000000001' and event = 'client_handoff'), 0, 'а продавец — нет');

select * from finish();
rollback;
