import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

// Выполняем настоящую функцию проверки самозанятых с подменой GoTrue/PostgREST и сервиса ФНС.
async function run({ headers = {}, body = {}, fns = { status: true, message: 'ok' }, fnsStatus = 200, allowed = true, jobs = [{ worker_id: 'w1', inn: '561200000001' }] } = {}) {
  const recorded = [];
  const fetched = [];
  let handler;
  const admin = {
    from: () => ({ select: () => ({ eq: () => ({ in: async (_c, ids) => ({ data: ids.filter((i) => i !== 'foreign').map((user_id) => ({ user_id })) }) }) }) }),
    rpc: async (name, args) => {
      if (name === 'list_npd_checks') return { data: jobs };
      if (name === 'record_npd_status') { recorded.push(args); return { error: null }; }
      return { data: null };
    },
  };
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: 'accountant' } } }) },
    rpc: async () => ({ data: allowed }),
  };
  const source = (await readFile('supabase/functions/check-npd-status/index.ts', 'utf8')).replace(/^import .*createClient.*;\n/m, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  vm.runInNewContext(js, {
    Deno: { env: { get: (k) => k }, serve: (fn) => { handler = fn; } },
    createClient: (_u, key) => (key === 'SUPABASE_SERVICE_ROLE_KEY' ? admin : user),
    fetch: async (url, init) => { fetched.push({ url, body: JSON.parse(init.body) }); return { ok: fnsStatus === 200, status: fnsStatus, json: async () => fns }; },
    Response, Request, URL, Date, JSON, String, Array, console: { error() {} },
  });
  const res = await handler(new Request('https://test.local/x', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json(), recorded, fetched };
}

test('По расписанию: действующий самозанятый записывается как active', async () => {
  const r = await run({ headers: { 'x-cron-secret': 'NOTIFY_CRON_SECRET' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.recorded.map((x) => x.p_status ?? x._status), ['active']);
  assert.equal(r.fetched[0].body.inn, '561200000001');
});
test('Снят с учёта: записывается inactive', async () => {
  const r = await run({ headers: { 'x-cron-secret': 'NOTIFY_CRON_SECRET' }, fns: { status: false, message: 'Не является плательщиком НПД' } });
  assert.equal(r.recorded[0]._status, 'inactive');
});
test('Лимит запросов ФНС не записывает ложный статус', async () => {
  const r = await run({ headers: { 'x-cron-secret': 'NOTIFY_CRON_SECRET' }, fnsStatus: 422 });
  assert.equal(r.recorded.length, 0);
  assert.equal(r.body.failed, 1);
});
test('Без секрета и без входа — отказ', async () => {
  const r = await run({});
  assert.equal(r.status, 403);
  assert.equal(r.fetched.length, 0);
});
test('Пользователь без права проверки получает отказ', async () => {
  const r = await run({ headers: { Authorization: 'Bearer t' }, body: { org_id: 'o', worker_ids: ['w1'] }, allowed: false });
  assert.equal(r.status, 403);
  assert.equal(r.fetched.length, 0);
});
test('Бухгалтер проверяет только исполнителей своей организации', async () => {
  const r = await run({ headers: { Authorization: 'Bearer t' }, body: { org_id: 'o', worker_ids: ['foreign'] } });
  assert.equal(r.status, 200);
  assert.equal(r.fetched.length, 0);
});
