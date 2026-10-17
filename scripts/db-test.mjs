/**
 * Локальная проверка миграций и SQL-тестов БЕЗ Docker.
 *
 * Поднимает настоящий Postgres (PGlite — Postgres, собранный в WASM) в памяти,
 * создаёт минимальную имитацию окружения Supabase (роли, схемы auth/storage/realtime,
 * auth.uid()), накатывает все миграции из supabase/migrations с нуля и выполняет
 * каждый supabase/tests/database/*.test.sql (pgTAP). Выходит с кодом 1, если упала
 * миграция или хоть одна проверка.
 *
 *   npm run db:local            миграции + все тесты
 *   npm run db:local -- 010     только тесты, чьё имя содержит «010»
 *
 * Имитация — не настоящий Supabase: политики хранилища и Realtime здесь проверяются
 * только на то, что SQL применяется. Права по RLS на таблицах public проверяются честно.
 */
import { PGlite } from "@electric-sql/pglite";
import { pgtap } from "@electric-sql/pglite-pgtap";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const MIGRATIONS = "supabase/migrations";
const TESTS = "supabase/tests/database";
const only = process.argv[2];

// Имитация того, что в настоящем Supabase создаётся до миграций проекта.
const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create role authenticator nologin noinherit;
  create role supabase_auth_admin nologin;

  create schema auth;
  create schema storage;
  create schema realtime;
  create schema extensions;
  grant usage on schema public, auth, storage, realtime, extensions to anon, authenticated, service_role;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    encrypted_password text,
    raw_user_meta_data jsonb default '{}'::jsonb,
    raw_app_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz default now()
  );

  -- как в GoTrue: идентификатор и роль берутся из claims текущего запроса
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
  $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select jsonb_build_object('sub', auth.uid(), 'role', auth.role())
  $$;

  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[],
    created_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text, owner uuid, metadata jsonb, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select string_to_array(name, '/')
  $$;

  create table realtime.messages (
    id uuid primary key default gen_random_uuid(),
    topic text, extension text, payload jsonb, event text, private boolean default false,
    inserted_at timestamptz default now()
  );
  alter table realtime.messages enable row level security;

  create publication supabase_realtime;

  -- как в настоящем Supabase: новые таблицы и функции в public доступны ролям API по умолчанию,
  -- а ограничивают их RLS и явные REVOKE в миграциях
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

let failed = 0;
const fail = (msg) => {
  failed++;
  console.log(msg);
};

const db = new PGlite({ extensions: { pgtap } });

console.log("ОКРУЖЕНИЕ (имитация Supabase)");
await db.exec(SUPABASE_STUBS);
console.log("  ✓ роли, схемы auth/storage/realtime, auth.uid()");

console.log("\nМИГРАЦИИ");
const migrations = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();
for (const f of migrations) {
  try {
    await db.exec(await readFile(join(MIGRATIONS, f), "utf8"));
    console.log(`  ✓ ${f}`);
  } catch (e) {
    fail(`  ✗ ${f}\n     ${e.message}`);
    break; // дальше миграции зависят друг от друга, смысла нет
  }
}

if (!failed) {
  console.log("\nТЕСТЫ");
  const tests = (await readdir(TESTS).catch(() => []))
    .filter((f) => f.endsWith(".test.sql") && (!only || f.includes(only)))
    .sort();
  if (!tests.length) console.log("  (нет файлов *.test.sql)");
  for (const f of tests) {
    console.log(`  ${f}`);
    let results;
    try {
      results = await db.exec(await readFile(join(TESTS, f), "utf8"));
    } catch (e) {
      fail(`    ✗ файл упал: ${e.message}`);
      await db.exec("rollback").catch(() => {});
      continue;
    }
    // pgTAP отдаёт строки вида «ok 1 - описание» / «not ok 2 - описание»
    const lines = results.flatMap((r) => r.rows.map((row) => String(Object.values(row)[0])));
    let planned = null;
    let seen = 0;
    for (const line of lines) {
      const plan = line.match(/^1\.\.(\d+)$/);
      if (plan) planned = Number(plan[1]);
      if (/^ok \d+/.test(line)) {
        seen++;
        console.log(`    ✓ ${line.replace(/^ok \d+ - ?/, "")}`);
      } else if (/^not ok \d+/.test(line)) {
        seen++;
        fail(`    ✗ ${line.replace(/^not ok \d+ - ?/, "")}`);
      } else if (line.startsWith("#")) {
        console.log(`      ${line}`);
      }
    }
    if (planned === null || planned !== seen) {
      fail(`    ✗ план ${planned ?? "не задан"}, выполнено проверок: ${seen}`);
    }
  }
}

console.log(failed ? `\nПРОВАЛ: ошибок ${failed}` : "\nВСЁ ЗЕЛЁНОЕ");
await db.close();
process.exit(failed ? 1 : 0);
