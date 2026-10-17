/**
 * Общая часть локальных проверок: имитация Supabase и накатка миграций на PGlite.
 */
import { PGlite } from "@electric-sql/pglite";
import { pgtap } from "@electric-sql/pglite-pgtap";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const MIGRATIONS = "supabase/migrations";

// Имитация того, что в настоящем Supabase создаётся до миграций проекта.
export const SUPABASE_STUBS = `
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
    banned_until timestamptz,
    created_at timestamptz default now()
  );
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade);

  -- как в GoTrue: идентификатор и роль берутся из claims текущего запроса
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
  $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb,
      jsonb_build_object('sub', auth.uid(), 'role', auth.role()))
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

  -- в настоящем Supabase роли API имеют права на таблицы хранилища; доступ ограничивают политики RLS
  grant all on all tables in schema storage to anon, authenticated, service_role;

  create publication supabase_realtime;

  -- как в настоящем Supabase: новые таблицы и функции в public доступны ролям API по умолчанию,
  -- а ограничивают их RLS и явные REVOKE в миграциях
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;


export async function bootDb({ log = () => {} } = {}) {
  const db = new PGlite({ extensions: { pgtap, btree_gist, pgcrypto } });
  await db.exec(SUPABASE_STUBS);
  const migrations = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of migrations) {
    await db.exec(await readFile(join(MIGRATIONS, f), "utf8"));
    log(f);
  }
  return db;
}
