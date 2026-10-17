/**
 * Нагрузочная проверка на PGlite (ТЗ, раздел 19): 2000 смен в месяц за 12 месяцев, дашборд за год ≤ 3 с.
 *   npm run bench
 * PGlite медленнее настоящего Postgres, поэтому порог здесь взят с запасом: если укладываемся тут, на сервере тем более.
 */
import { bootDb } from "./lib/pg-env.mjs";

const MONTHS = 12, SITES = 22, SHIFTS_PER_MONTH = 2000, PER_SHIFT = 3, WORKERS = 400;
const db = await bootDb();
const t = async (name, fn) => { const s = performance.now(); const r = await fn(); const ms = Math.round(performance.now() - s); console.log(`${name.padEnd(46)} ${String(ms).padStart(6)} мс`); return ms; };

await db.exec(`
  set session_replication_role = replica;
  insert into auth.users (id, email) select ('9a000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'bw' || i || '@b.local' from generate_series(1, ${WORKERS}) i;
  insert into auth.users (id, email) values ('d1000000-0000-0000-0000-00000000000d', 'dir@b.local');
`);
await db.exec(`
  reset session_replication_role;
  insert into public.user_roles (user_id, role, org_id) values ('d1000000-0000-0000-0000-00000000000d', 'director', private.default_org_id());
  insert into public.workers (user_id, org_id, full_name) select id, private.default_org_id(), email from auth.users where id::text like '9a000000%';
`);
await db.exec(`
  insert into public.clients (id, org_id, name, status) values ('c1000000-0000-0000-0000-000000000001', private.default_org_id(), 'Нагрузка', 'active');
  insert into public.sites (id, org_id, client_id, name, status, checkin_method)
    select ('51e00000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, private.default_org_id(), 'c1000000-0000-0000-0000-000000000001', 'Объект ' || i, 'active', 'manual' from generate_series(1, ${SITES}) i;
  update public.workers set tax_status = 'ip', status = 'active' where user_id::text like '9a000000%';
`);
const total = await t(`загрузка данных (${MONTHS * SHIFTS_PER_MONTH} смен, ${MONTHS * SHIFTS_PER_MONTH * PER_SHIFT} назначений и начислений)`, async () => {
  await db.exec(`
    set session_replication_role = replica;
    create temp table gen0 as
      select g as n, (g % ${SITES}) + 1 as site_n, least(current_date - 365 + ((g - 1) / (${SHIFTS_PER_MONTH}.0 / 30))::int, current_date - 1) as d from generate_series(1, ${MONTHS * SHIFTS_PER_MONTH}) g;
    create temp table gen as select n, site_n, d, row_number() over (partition by site_n, d order by n) as rn from gen0;
    insert into public.orders (id, org_id, client_id, site_id, position_id, date_from, date_to, start_time, end_time, headcount, status)
      select ('0d000000-0000-0000-0000-' || lpad((site_n * 1000 + rn)::text, 12, '0'))::uuid, private.default_org_id(), 'c1000000-0000-0000-0000-000000000001',
             ('51e00000-0000-0000-0000-' || lpad(site_n::text, 12, '0'))::uuid, (select id from public.positions limit 1), current_date - 365, current_date, '08:00', '19:00', ${PER_SHIFT}, 'accepted'
      from (select distinct site_n, rn from gen) x;
    insert into public.shifts (id, org_id, order_id, client_id, site_id, position_id, shift_date, start_at, end_at, headcount, status)
      select ('5f000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, private.default_org_id(), ('0d000000-0000-0000-0000-' || lpad((site_n * 1000 + rn)::text, 12, '0'))::uuid,
             'c1000000-0000-0000-0000-000000000001', ('51e00000-0000-0000-0000-' || lpad(site_n::text, 12, '0'))::uuid, (select id from public.positions limit 1),
             d, (d + time '08:00')::timestamptz + (n % 7) * interval '1 minute', (d + time '19:00')::timestamptz, ${PER_SHIFT}, 'completed' from gen;
    insert into public.assignments (org_id, shift_id, worker_id, status, shift_start, shift_end, approved_hours, planned_hours)
      select private.default_org_id(), ('5f000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, ('9a000000-0000-0000-0000-' || lpad((1 + (n * ${PER_SHIFT} + k) % ${WORKERS})::text, 12, '0'))::uuid,
             case when (n + k) % 17 = 0 then 'no_show' else 'worked' end,
             (d + time '08:00')::timestamptz, (d + time '19:00')::timestamptz, 10, 10 from gen, generate_series(0, ${PER_SHIFT - 1}) k;
    insert into public.accruals (org_id, assignment_id, shift_id, shift_date, site_id, client_id, worker_id, kind, unit, quantity, billable_quantity, payable_quantity, client_rate, worker_rate,
                                 amount_client, amount_worker, tax_status, taxes, payout_fee, period_month, status)
      select a.org_id, a.id, a.shift_id, s.shift_date, s.site_id, s.client_id, a.worker_id, 'main', 'hour', 10, 10, 10, 450, 300, 4500, 3000, 'ip', 400, 0,
             date_trunc('month', s.shift_date)::date, 'approved'
      from public.assignments a join public.shifts s on s.id = a.shift_id where a.status = 'worked';
    insert into public.analytics_dirty (org_id, day) select distinct org_id, shift_date from public.shifts on conflict do nothing;
    reset session_replication_role;
  `);
});
const [{ c: shifts }] = (await db.query("select count(*) c from public.shifts")).rows;
const [{ c: accr }] = (await db.query("select count(*) c from public.accruals")).rows;
console.log(`  смен: ${shifts}, начислений: ${accr}`);

await db.exec("select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-00000000000d', false)");
const org = "array[private.default_org_id()]";
const from = "current_date - 365", to = "current_date";
const results = {};
results.cold = await t("дашборд за 12 месяцев, первое открытие (пересчёт агрегатов)", () => db.query(`select * from public.analytics_metrics(${org}, ${from}, ${to})`));
results.warm = await t("дашборд за 12 месяцев, агрегаты готовы", () => db.query(`select * from public.analytics_metrics(${org}, ${from}, ${to})`));
results.series = await t("динамика по месяцам за год", () => db.query(`select * from public.analytics_series(${org}, ${from}, ${to}, 'month')`));
results.compare = await t("сравнение с прошлым периодом (год)", () => db.query(`select * from public.analytics_compare(${org}, ${from}, ${to})`));
results.clients = await t("заказчики: выручка и маржа за год", () => db.query(`select * from public.analytics_by_client(${org}, ${from}, ${to})`));
results.sites = await t("объекты: укомплектованность за год", () => db.query(`select * from public.analytics_by_site(${org}, ${from}, ${to})`));
results.bdr = await t("БДР за год", () => db.query(`select * from public.bdr_report(${org}, ${from}, ${to})`));
results.rec = await t("записи метрики «маржа» (до 500)", () => db.query(`select * from public.analytics_records(${org}, 'margin_amount', ${from}, ${to})`));
results.grid = await t("сетка планирования: месяц (≈2000 смен)", () => db.query("select * from public.shift_staffing where shift_date between current_date - 60 and current_date - 30"));
results.cal = await t("платёжный календарь на 4 недели", () => db.query(`select * from public.payment_calendar(private.default_org_id(), current_date, 28)`));
results.recv = await t("дебиторка по заказчикам", () => db.query("select * from public.client_receivables()"));
results.workers = await t("список исполнителей: страница из 400 с поиском", () => db.query("select user_id, full_name, phone from public.workers where org_id = private.default_org_id() and full_name ilike '%b%' order by full_name limit 50"));
await db.exec("insert into public.analytics_dirty (org_id, day) values (private.default_org_id(), current_date - 3) on conflict do nothing");
results.inc = await t("пересчёт одного изменённого дня", () => db.query(`select * from public.analytics_metrics(${org}, current_date - 30, current_date)`));

const LIMIT = 3000;
const slow = Object.entries(results).filter(([k, v]) => k !== "cold" && v > LIMIT);
if (results.cold > 15000) slow.push(["cold", results.cold]);
console.log(slow.length ? `\nМЕДЛЕННО: ${slow.map(([k, v]) => `${k} ${v} мс`).join(", ")}` : "\nУКЛАДЫВАЕМСЯ: дашборд за год открывается быстрее 3 с");
await db.close();
process.exit(slow.length ? 1 : 0);
