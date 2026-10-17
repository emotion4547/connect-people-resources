import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Разбор выписки 1С проверяется на настоящем коде интерфейса: TypeScript переводится в JavaScript на лету.
const source = await readFile('src/lib/kl1c.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const mod = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

const SAMPLE = `1CClientBankExchange
ВерсияФормата=1.02
Кодировка=Windows
СекцияРасчСчет
ДатаНачала=01.03.2026
ДатаКонца=31.03.2026
РасчСчет=40702810000000000001
КонецРасчСчет
СекцияДокумент=Платежное поручение
Номер=101
Дата=05.03.2026
Сумма=5000.00
ПлательщикСчет=40702810111111111111
ПлательщикИНН=5612345678
Плательщик1=ООО Ромашка
ПолучательСчет=40702810000000000001
ДатаПоступления=06.03.2026
НазначениеПлатежа=Оплата по счёту СЧ-2026/17
КонецДокумента
СекцияДокумент=Платежное поручение
Номер=7
Дата=07.03.2026
Сумма=1200,50
ПлательщикСчет=40702810000000000001
ПолучательСчет=40702810222222222222
НазначениеПлатежа=Зарплата
КонецДокумента
КонецФайла`;

test('входящий платёж разобран, исходящий пропущен', () => {
  const r = mod.parseStatement(SAMPLE);
  assert.equal(r.account, '40702810000000000001');
  assert.equal(r.payments.length, 1);
  assert.equal(r.skipped, 1);
  assert.deepEqual(r.payments[0], {
    date: '2026-03-06', amount: 5000, number: '101', payer_name: 'ООО Ромашка', payer_inn: '5612345678', purpose: 'Оплата по счёту СЧ-2026/17',
  });
});

// Кодирование в Windows-1251 для проверки: буквы А–я идут подряд с кода 0xC0.
const cp1251 = (s) => Buffer.from([...s].map((c) => {
  const n = c.charCodeAt(0);
  if (n >= 0x410 && n <= 0x44f) return n - 0x410 + 0xc0;
  if (n === 0x401) return 0xa8;
  if (n === 0x451) return 0xb8;
  return n;
}));

test('выписка в Windows-1251 читается без искажений', () => {
  const bytes = cp1251(SAMPLE);
  const text = mod.decodeStatement(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.equal(mod.parseStatement(text).payments[0].payer_name, 'ООО Ромашка');
});
