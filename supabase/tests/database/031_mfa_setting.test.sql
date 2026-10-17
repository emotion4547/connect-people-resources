-- Двухфакторный вход включается настройкой и по умолчанию выключен (иначе при выкладке
-- можно запереть администраторов, не успевших подключить приложение-аутентификатор).
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(2);

select is(public.get_setting(private.default_org_id(), 'auth.mfa_enforced'), 'false'::jsonb,
  'Обязательность двухфакторного входа по умолчанию выключена');
select is((select value_type from public.setting_definitions where key = 'auth.mfa_enforced'), 'boolean',
  'Настройка — переключатель да/нет');

select * from finish();
rollback;
