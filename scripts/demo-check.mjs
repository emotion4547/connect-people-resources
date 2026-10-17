// Проверка демо-данных на локальной базе: заводит тестовые учётки, выполняет deploy/scripts/demo-org.sql и печатает итоги.
import { readFile } from "node:fs/promises";
import { bootDb } from "./lib/pg-env.mjs";
const db = await bootDb();
// В имитации Supabase у auth.users меньше столбцов, чем в настоящем GoTrue
await db.exec(`alter table auth.users add column if not exists instance_id uuid, add column if not exists aud text, add column if not exists role text, add column if not exists updated_at timestamptz, add column if not exists email_confirmed_at timestamptz`);
const users = [["director", "director", "management"], ["sales", "sales", "sales"], ["sites", "site_manager", "sites"], ["recruiter", "recruiter", "hiring"], ["accountant", "accountant", "accounting"], ["client", "client_admin", null]];
for (const [k, role, dept] of users) {
  await db.exec(`insert into auth.users (id, email) values (gen_random_uuid(), 'test-${k}@test.rabota-vsem-56.ru');`);
  await db.exec(`delete from public.user_roles where user_id = (select id from auth.users where email = 'test-${k}@test.rabota-vsem-56.ru') and role = 'worker';
    delete from public.workers where user_id = (select id from auth.users where email = 'test-${k}@test.rabota-vsem-56.ru');
    insert into public.user_roles (user_id, role, org_id) select id, '${role}', private.default_org_id() from auth.users where email = 'test-${k}@test.rabota-vsem-56.ru';
    ${dept ? `insert into public.staff_profiles (user_id, full_name, department) select id, 'ТЕСТ ${k}', '${dept}' from auth.users where email = 'test-${k}@test.rabota-vsem-56.ru';` : ""}`);
}
const sql = await readFile("deploy/scripts/demo-org.sql", "utf8");
const t = performance.now();
try { await db.exec(sql); } catch (e) { console.log("ОШИБКА:", e.message, e.where ?? ""); await db.close(); process.exit(1); }
console.log(`демо создано за ${Math.round(performance.now() - t)} мс`);
const q = async (label, sqlText) => console.log(label.padEnd(34), JSON.stringify((await db.query(sqlText)).rows[0]));
const org = "(select id from public.organizations where name = 'ТЕСТ Демо-организация')";
await q("смен / назначений", `select (select count(*) from public.shifts where org_id = ${org}) shifts, (select count(*) from public.assignments where org_id = ${org}) asg`);
await q("статусы назначений", `select jsonb_object_agg(status, n) from (select status, count(*) n from public.assignments where org_id = ${org} group by 1) x`);
await q("начислений, выручка", `select count(*), sum(amount_client) rev, sum(amount_worker) wc from public.accruals where org_id = ${org}`);
await q("документы", `select kind, count(*) from public.client_documents where org_id = ${org} group by 1 order by 1 limit 1`);
await q("документы статусы", `select jsonb_object_agg(k, n) from (select kind||':'||status k, count(*) n from public.client_documents where org_id = ${org} group by 1) x`);
await q("платежи", `select count(*), sum(amount) amt, sum(allocated_amount) alloc from public.client_payments where org_id = ${org}`);
await q("ДДС", `select count(*), sum(amount) from public.cashflow_entries where org_id = ${org}`);
await q("сделки", `select count(*) from public.deals where org_id = ${org}`);
await q("кандидаты", `select count(*) from public.candidates where org_id = ${org}`);
await q("вахта", `select (select count(*) from public.order_rotations where org_id = ${org}) r, (select count(*) from public.rotation_members where org_id = ${org}) m`);
await db.exec(`select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'test-director@test.rabota-vsem-56.ru'), false)`);
const m = await db.query(`select metric, value from public.analytics_metrics(array[${org}], current_date - 30, current_date + 5)`);
console.log("метрики:", m.rows.map((r) => `${r.metric}=${r.value}`).join(", "));
const conf = await db.query(`select count(*) from public.document_conflicts(${org}, current_date, current_date + 30)`);
console.log("смены под угрозой:", conf.rows[0].count);
await db.close();
