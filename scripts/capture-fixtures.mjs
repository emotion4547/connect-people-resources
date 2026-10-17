/**
 * Снимает настоящие ответы сервера по демо-организации в src/test/fixtures/live.json, чтобы тесты страниц гонялись на реальных формах данных
 * (числа строками, null, порядок полей), а не на выдуманных. Только чтение. Нужны учётные записи как для live-smoke.mjs.
 *   LIVE_ACCOUNTS=/путь/accounts.json node scripts/capture-fixtures.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const URL = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const acc = JSON.parse(readFileSync(process.env.LIVE_ACCOUNTS ?? '.live-accounts.json', 'utf8'));
const login = async (e, p) => (await (await fetch(URL + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email: e, password: p }) })).json()).access_token;
const rpc = async (tok, fn, args) => (await (await fetch(URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: KEY, authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify(args) })).json());
const get = async (tok, path) => (await (await fetch(URL + '/rest/v1/' + path, { headers: { apikey: KEY, authorization: 'Bearer ' + tok } })).json());
const dir = await login(...acc.director), sal = await login(...acc.sales), cli = await login(...acc.client);
const orgs = await get(dir, 'organizations?select=id,name');
const org = orgs.find((o) => o.name.includes('Демо')).id;
const today = new Date().toISOString().slice(0, 10), from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10), to = new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10);
const monthFrom = today.slice(0, 7) + '-01';
const O = [org];
const out = {
  rpc: {
    analytics_compare: await rpc(dir, 'analytics_compare', { _org_ids: O, _from: from, _to: to }),
    analytics_series: await rpc(dir, 'analytics_series', { _org_ids: O, _from: from, _to: to, _bucket: 'month' }),
    analytics_counters: await rpc(dir, 'analytics_counters', { _org_ids: O, _from: from, _to: to }),
    analytics_by_client: await rpc(dir, 'analytics_by_client', { _org_ids: O, _from: from, _to: to }),
    analytics_by_site: await rpc(dir, 'analytics_by_site', { _org_ids: O, _from: from, _to: to }),
    analytics_candidates: await rpc(dir, 'analytics_candidates', { _org_ids: O, _from: from, _to: to }),
    analytics_plan_fact: await rpc(dir, 'analytics_plan_fact', { _org_ids: O, _from: monthFrom, _to: to }),
    analytics_unconfirmed: await rpc(dir, 'analytics_unconfirmed', { _org_ids: O }),
    bdr_report: await rpc(dir, 'bdr_report', { _org_ids: O, _from: monthFrom, _to: to }),
    bdr_breakdown: await rpc(dir, 'bdr_breakdown', { _org_ids: O, _from: from, _to: to, _dimension: 'client' }),
    payment_calendar: await rpc(dir, 'payment_calendar', { _org_id: org, _from: today, _days: 28 }),
    cash_balances: await rpc(dir, 'cash_balances', { _org_id: org, _date: today }),
    cash_total_balance: await rpc(dir, 'cash_total_balance', { _org_ids: O, _date: today }),
    cashflow_report: await rpc(dir, 'cashflow_report', { _org_ids: O, _from: from, _to: to }),
    deal_funnel: await rpc(dir, 'deal_funnel', { _org_id: org }),
    deal_lost_reasons: await rpc(dir, 'deal_lost_reasons', { _org_id: org, _from: from, _to: to }),
    my_sales_day: await rpc(sal, 'my_sales_day', { _org_id: org }),
    sales_plan_fact: await rpc(dir, 'sales_plan_fact', { _org_id: org, _from: monthFrom, _to: to }),
    document_registry: await rpc(dir, 'document_registry', { _org_id: org }),
    document_conflicts: await rpc(dir, 'document_conflicts', { _org_id: org, _from: today, _to: to }),
    rotation_calendar: await rpc(dir, 'rotation_calendar', { _org_id: org, _from: today, _days: 28 }),
    rotation_housing_load: await rpc(dir, 'rotation_housing_load', { _org_id: org, _from: today, _days: 28 }),
    client_receivables: await rpc(dir, 'client_receivables', {}),
  },
  tables: {
    deals: await get(dir, `deals?select=*&org_id=eq.${org}`),
    deal_quotes: await get(dir, 'deal_quotes?select=*'),
    deal_touches: await get(dir, 'deal_touches?select=*'),
    cash_accounts: await get(dir, `cash_accounts?select=*&org_id=eq.${org}`),
    staff_profiles: await get(dir, 'staff_profiles?select=user_id,full_name'),
    positions: await get(dir, `positions?select=id,name&org_id=eq.${org}`),
  },
};
const clientsRows = await get(cli, 'clients?select=id,name');
out.clientId = clientsRows.find((c) => c.name === 'ТЕСТ Логистик')?.id ?? clientsRows[0]?.id;
out.clientDashboard = await rpc(cli, 'client_dashboard', { _client_id: out.clientId, _from: from, _to: to });
const bad = Object.entries(out.rpc).filter(([, v]) => !Array.isArray(v) && typeof v !== 'string' && typeof v !== 'number');
if (bad.length) { console.error('Ошибки в ответах:', bad.map(([k, v]) => k + ': ' + JSON.stringify(v).slice(0, 120))); process.exit(1); }
mkdirSync('src/test/fixtures', { recursive: true });
writeFileSync('src/test/fixtures/live.json', JSON.stringify(out, null, 1));
console.log('снято:', Object.entries(out.rpc).map(([k, v]) => `${k}=${Array.isArray(v) ? v.length : v}`).join(', '));
