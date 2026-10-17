import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

// Настоящая функция отправки на платформу с подменой базы и PAYOUT_PLATFORM.
async function run({ provider, allowed = true, lines = [{ line_id: 'l1', worker_name: 'А', requisites: '+7900', amount: 100, registry_number: 'РВ-1', inn: '1' }], auth = true } = {}) {
  const recorded = [];
  let handler;
  const admin = { rpc: async (name, args) => { if (name === 'platform_registry_payload') return { data: lines }; recorded.push(args); return { data: null }; } };
  const user = { auth: { getUser: async () => ({ data: { user: { id: 'acc' } } }) }, rpc: async () => ({ data: allowed }) };
  const source = (await readFile('supabase/functions/send-platform-payouts/index.ts', 'utf8')).replace(/^import .*createClient.*;\n/m, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  vm.runInNewContext(js, {
    Deno: { env: { get: (k) => (k === 'PAYOUT_PLATFORM' ? provider : k) }, serve: (fn) => { handler = fn; } },
    createClient: (_u, key) => (key === 'SUPABASE_SERVICE_ROLE_KEY' ? admin : user),
    Response, Request, JSON, console: { error() {} },
  });
  const res = await handler(new Request('https://t.local/x', { method: 'POST', headers: auth ? { Authorization: 'Bearer t' } : {}, body: JSON.stringify({ registry_id: 'r1' }) }));
  return { status: res.status, body: await res.json(), recorded };
}

test('Платформа не выбрана: канал честно не подключён, ничего не записывается', async () => {
  const r = await run({});
  assert.equal(r.status, 501);
  assert.equal(r.recorded.length, 0);
});
test('Без входа и без права отправки — отказ', async () => {
  assert.equal((await run({ provider: 'mock', auth: false })).status, 403);
  assert.equal((await run({ provider: 'mock', allowed: false })).status, 403);
});
test('Песочница: проведённая строка и строка с ошибкой записываются по отдельности', async () => {
  const r = await run({ provider: 'mock', lines: [
    { line_id: 'a', worker_name: 'А', requisites: '+7900', amount: 100, registry_number: 'РВ-1', inn: '1' },
    { line_id: 'b', worker_name: 'Б', requisites: 'ERR', amount: 200, registry_number: 'РВ-1', inn: '2' },
  ] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.paid, r.body.error], [1, 1]);
  assert.deepEqual(r.recorded.map((x) => x._status), ['paid', 'error']);
});
