import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

// Выполняем настоящий обработчик с подменой только внешних API GoTrue/PostgREST.
// Это проверяет порядок побочных эффектов; совместимость с живым GoTrue проверяется на стенде.
async function run({ linkError = false, admissionError = false, denied = false } = {}) {
  const calls = [];
  let handler;
  const admin = {
    from: (table) => ({ select: () => ({ eq: () => ({
      single: async () => ({ data: { full_name: 'Тест', phone: '+79000000000', stage: 'documents' } }),
      maybeSingle: async () => ({ data: null }),
    }) }) }),
    rpc: async () => { calls.push('admit'); return { error: admissionError ? new Error('Допуск отклонён') : null }; },
    auth: { admin: {
      createUser: async () => { calls.push('create'); return { data: { user: { id: 'test-worker' } } }; },
      generateLink: async () => { calls.push('link'); return { data: { properties: { action_link: 'https://test.local/link' } }, error: linkError ? new Error('Сбой ссылки') : null }; },
      deleteUser: async () => { calls.push('delete'); return {}; },
    } },
  };
  const user = {
    auth: { getUser: async () => ({ data: { user: { id: 'test-recruiter' } } }) },
    rpc: async () => ({ data: [], error: denied ? { code: '42501', message: 'Нет доступа' } : null }),
  };
  const source = (await readFile('supabase/functions/admit-candidate/index.ts', 'utf8'))
    .replace(/^import .*createClient.*;\n/m, '');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  vm.runInNewContext(js, {
    Deno: { env: { get: (key) => key }, serve: (fn) => { handler = fn; } },
    createClient: (_url, key) => key === 'SUPABASE_SERVICE_ROLE_KEY' ? admin : user,
    Response, crypto: globalThis.crypto, console: { error() {} },
  });
  const response = await handler(new Request('https://test.local/admit', {
    method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidate_id: 'test-candidate' }),
  }));
  return { calls, status: response.status, body: await response.json() };
}

test('Ссылка создаётся до переноса документов, успешный исполнитель не удаляется', async () => {
  const r = await run();
  assert.deepEqual(r.calls, ['create', 'link', 'admit']);
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
});
test('Сбой выдачи ссылки не переводит кандидата в допущенные', async () => {
  const r = await run({ linkError: true });
  assert.deepEqual(r.calls, ['create', 'link', 'delete']);
  assert.equal(r.status, 500);
});
test('Отклонённый допуск убирает пустую учётную запись', async () => {
  const r = await run({ admissionError: true });
  assert.deepEqual(r.calls, ['create', 'link', 'admit', 'delete']);
  assert.equal(r.status, 500);
});
test('Отказ прав не создаёт учётную запись', async () => {
  const r = await run({ denied: true });
  assert.deepEqual(r.calls, []);
  assert.equal(r.status, 403);
});
test('На выкладку идёт та же функция, что проверена тестами', async () => {
  for (const name of ['admit-candidate', 'invite-staff', 'delete-user', 'send-webhook', 'deliver-notifications']) {
    assert.equal(await readFile(`supabase/functions/${name}/index.ts`, 'utf8'),
      await readFile(`deploy/supabase/volumes/functions/${name}/index.ts`, 'utf8'), name);
  }
});
