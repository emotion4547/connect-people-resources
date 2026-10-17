-- Проверка шагов 1–3 на живой базе. Всё выполняется в транзакции и откатывается:
-- тестовые организации, пользователи и записи после проверки не остаются.
-- Запуск: psql -v ON_ERROR_STOP=1 -f stage1-smoke.sql (скрипт apply-stage1.sh делает это сам).
begin;

create function pg_temp.check(_name text, _ok boolean) returns void language plpgsql as $$
begin
  if _ok is not true then raise exception 'ПРОВАЛ: %', _name; end if;
  raise notice 'OK: %', _name;
end $$;

-- Выполняет запрос и сообщает, отклонила ли его база.
create function pg_temp.denied(_sql text) returns boolean language plpgsql as $$
begin
  execute _sql;
  return false;
exception when others then
  return true;
end $$;

create function pg_temp.rows_changed(_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute _sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.check(text, boolean), pg_temp.denied(text), pg_temp.rows_changed(text) to authenticated, anon;

-- Состояние после миграций
select pg_temp.check('есть организация по умолчанию', (select count(*) from public.organizations) >= 1);
select pg_temp.check('у всех ролей есть организация', (select count(*) from public.user_roles where org_id is null) = 0);
select pg_temp.check('матрица прав: 480 строк на организацию',
  (select bool_and(n = 480) from (select count(*) n from public.role_permissions group by org_id) t));
select pg_temp.check('в каталоге настроек не меньше 21 правила', (select count(*) from public.setting_definitions) >= 21);
select pg_temp.check('двухфакторный вход по умолчанию выключен', public.get_setting(private.default_org_id(), 'auth.mfa_enforced') = 'false'::jsonb);
select pg_temp.check('RLS включён на новых таблицах',
  (select bool_and(relrowsecurity) from pg_class where oid in (
    'public.organizations'::regclass, 'public.audit_log'::regclass, 'public.org_settings'::regclass,
    'public.tax_status_rates'::regclass, 'public.staff_profiles'::regclass,
    'public.role_permissions'::regclass, 'public.directories'::regclass)));

select pg_temp.check('позиции заведены', (select count(*) from public.positions) >= 7);
select pg_temp.check('расчёт маржи совпадает с примером ТЗ (самозанятый, 450/300 → 144 ₽)',
  (select margin from public.calc_margins(private.default_org_id(), 450, 300) where status = 'self_employed') = 144.00);
select pg_temp.check('у заказчиков нет брошенных ссылок на организацию', (select count(*) from public.clients c where not exists (select 1 from public.organizations o where o.id = c.org_id)) = 0);

select pg_temp.check('у всех объектов есть организация и секрет QR',
  (select count(*) from public.sites s where not exists (select 1 from public.site_secrets x where x.site_id = s.id)) = 0);
select pg_temp.check('типы документов заведены', (select count(*) from public.directories where kind = 'document_type') >= 8);

select pg_temp.check('у каждой смены есть ставки', (select count(*) from public.shifts sh where not exists (select 1 from public.shift_rates r where r.shift_id = sh.id)) = 0);

select pg_temp.check('у каждого исполнителя есть запись workers',
  (select count(*) from public.user_roles ur where ur.role = 'worker' and not exists (select 1 from public.workers w where w.user_id = ur.user_id)) = 0);

select pg_temp.check('у типов документов есть коды', (select count(*) from public.directories where kind = 'document_type' and code is null) = 0);
select pg_temp.check('шифрование доступно (расширение pgcrypto)', exists (select 1 from pg_extension where extname = 'pgcrypto'));

-- Сценарий: администраторы двух организаций, обычный сотрудник
insert into public.organizations (id, name) values ('b2000000-0000-0000-0000-000000000002', 'ПРОВЕРКА организация 2');
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'smoke-a@invalid.test'),
  ('b0000000-0000-0000-0000-00000000000b', 'smoke-b@invalid.test'),
  ('c0000000-0000-0000-0000-00000000000c', 'smoke-c@invalid.test');
update public.user_roles set role = 'admin' where user_id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');
update public.user_roles set role = 'sales' where user_id = 'c0000000-0000-0000-0000-00000000000c';
update public.user_roles set org_id = 'b2000000-0000-0000-0000-000000000002' where user_id = 'b0000000-0000-0000-0000-00000000000b';
insert into public.staff_profiles (user_id, full_name, department) values ('c0000000-0000-0000-0000-00000000000c', 'Проверочный сотрудник', 'sales');

select pg_temp.check('регистрация выдала роль в организации по умолчанию',
  (select org_id from public.user_roles where user_id = 'a0000000-0000-0000-0000-00000000000a' and role = 'admin') = private.default_org_id());

set local role authenticated;
set local request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
select pg_temp.check('администратор организации 1 видит только свою организацию', (select count(*) from public.organizations) = 1);
select pg_temp.check('администратор не правит чужую организацию',
  pg_temp.rows_changed($$update public.organizations set name = 'взлом' where id = 'b2000000-0000-0000-0000-000000000002'$$) = 0);
select pg_temp.check('администратор меняет настройку своей организации',
  not pg_temp.denied($$insert into public.org_settings (org_id, key, value) values (private.default_org_id(), 'timesheet.autoconfirm_hours', '72')$$));
select pg_temp.check('настройка записана в журнал',
  exists (select 1 from public.audit_log where table_name = 'org_settings' and actor_id = 'a0000000-0000-0000-0000-00000000000a'));
select pg_temp.check('администратор не видит журнал чужой организации',
  (select count(*) from public.audit_log where org_id = 'b2000000-0000-0000-0000-000000000002') = 0);
select pg_temp.check('журнал нельзя менять клиенту', pg_temp.denied($$update public.audit_log set note = 'x'$$));
select pg_temp.check('администратор блокирует сотрудника', not pg_temp.denied($$select public.block_staff('c0000000-0000-0000-0000-00000000000c', 'проверка')$$));

reset role;
select pg_temp.check('заблокированный теряет права сразу',
  private.permission_scope('c0000000-0000-0000-0000-00000000000c', private.default_org_id(), 'clients', 'view') = 'none');
select pg_temp.check('журнал нельзя менять и владельцу', pg_temp.denied($$update public.audit_log set note = 'x'$$));

set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-0000-0000-00000000000c';
select pg_temp.check('заблокированный не видит организацию', (select count(*) from public.organizations) = 0);

set local request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
select pg_temp.check('администратор организации 2 не видит настройки организации 1',
  (select count(*) from public.org_settings where org_id = private.default_org_id()) = 0);

reset role;
set local role anon;
select pg_temp.check('аноним не читает организации', pg_temp.denied($$select count(*) from public.organizations$$));
select pg_temp.check('аноним не читает табели', pg_temp.denied($$select count(*) from public.timesheets$$));
select pg_temp.check('аноним не читает начисления', pg_temp.denied($$select count(*) from public.accruals$$));
select pg_temp.check('аноним не читает документы заказчикам', pg_temp.denied($$select count(*) from public.client_documents$$));
select pg_temp.check('аноним не читает платежи', pg_temp.denied($$select count(*) from public.client_payments$$));
select pg_temp.check('аноним не видит реквизиты выплат', pg_temp.denied($$select * from public.my_payout_requisites()$$));
select pg_temp.check('аноним не читает закрытия месяцев', pg_temp.denied($$select count(*) from public.period_locks$$));
select pg_temp.check('аноним не выгружает в 1С', pg_temp.denied($$select * from public.export_1c_clients(private.default_org_id())$$));
select pg_temp.check('аноним не видит дебиторку', pg_temp.denied($$select * from public.client_receivables()$$));
select pg_temp.check('аноним не читает журнал переноса', pg_temp.denied($$select count(*) from public.legacy_migration_log$$));
select pg_temp.check('аноним не читает ленту уведомлений', pg_temp.denied($$select count(*) from public.notifications$$));
select pg_temp.check('аноним не берёт очередь доставки', pg_temp.denied($$select * from public.claim_outbox(1)$$));
select pg_temp.check('аноним не видит смены заказчика', pg_temp.denied($$select * from public.client_shifts(current_date, current_date)$$));
select pg_temp.check('аноним не видит заработок', pg_temp.denied($$select * from public.worker_earnings(current_date, current_date)$$));
select pg_temp.check('аноним не видит ведомость', pg_temp.denied($$select * from public.worker_statement(current_date, current_date)$$));
select pg_temp.check('аноним не отмечает приход', pg_temp.denied($$select public.check_in(gen_random_uuid())$$));

rollback;
