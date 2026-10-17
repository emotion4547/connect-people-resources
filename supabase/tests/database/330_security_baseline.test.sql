-- Базовые проверки безопасности по всей схеме: ловят таблицы без RLS и функции SECURITY DEFINER без search_path.
-- (Права anon здесь не проверяются: имитация Supabase выдаёт их всем таблицам по умолчанию, как и настоящий стек;
-- реальные отказы аноним проверяет deploy/scripts/stage1-smoke.sql на живой базе.)
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(2);

select is((select coalesce(string_agg(c.relname, ', ' order by c.relname), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), '', 'У каждой таблицы public включена защита строк (RLS)');

select is((select coalesce(string_agg(n.nspname || '.' || p.proname, ', ' order by p.proname), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'private') and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')), '',
         'У каждой функции SECURITY DEFINER задан search_path');

select * from finish();
rollback;
