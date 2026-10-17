import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile('src/lib/bankFiles.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

const payer = { name: 'ООО Работа для Всех', inn: '5612345678', kpp: null, bank_account: '40702810000000000001', bank_name: 'Т-Банк', bik: '044525974' };
const line = (o = {}) => ({ worker_name: 'Иванов Иван', requisites: 'x', account: '40817810000000000002', bik: '044525225', amount: 2000, purpose: 'Оплата услуг, реестр РВ-2026/1', registry_number: 'РВ-2026/1', ...o });

test('Кириллица кодируется в Windows-1251', () => {
  const bytes = mod.encodeCp1251('Ёж № Яя');
  assert.deepEqual([...bytes], [0xa8, 0xe6, 0x20, 0xb9, 0x20, 0xdf, 0xff]);
});

test('Поручение содержит сумму, счета и назначение; карта пропускается', () => {
  const { text, skipped } = mod.buildPaymentOrders(payer, [line(), line({ account: null, bik: null, worker_name: 'С картой' })], new Date(2026, 2, 5));
  assert.match(text, /^1CClientBankExchange\r\n/);
  assert.match(text, /Сумма=2000\.00/);
  assert.match(text, /ПолучательСчет=40817810000000000002/);
  assert.match(text, /ПлательщикСчет=40702810000000000001/);
  assert.match(text, /Дата=05\.03\.2026/);
  assert.match(text, /НазначениеПлатежа=Оплата услуг, реестр РВ-2026\/1/);
  assert.equal((text.match(/СекцияДокумент/g) ?? []).length, 1);
  assert.equal(skipped.length, 1);
  assert.match(text, /КонецФайла\r\n$/);
});
