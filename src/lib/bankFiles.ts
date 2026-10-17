// Файлы для интернет-банка (ТЗ, раздел 15, В-4): платёжные поручения в формате обмена с 1С (1c_to_kl.txt), который принимают
// Т-Банк, Точка и большинство банков, и таблица для ручной загрузки. Кодировка файла 1С — Windows-1251.

export interface PayLine { worker_name: string; requisites: string | null; account: string | null; bik: string | null; amount: number; purpose: string; registry_number: string }
export interface Payer { name: string; inn: string | null; kpp: string | null; bank_account: string | null; bank_name: string | null; bik: string | null }

// Кодирование в Windows-1251: русские буквы идут подряд с 0xC0, остальное — по таблице; незнакомый знак заменяется «?».
const EXTRA: Record<string, number> = { 'Ё': 0xa8, 'ё': 0xb8, '№': 0xb9, '«': 0xab, '»': 0xbb, '—': 0x97, '–': 0x96, '’': 0x92, '“': 0x93, '”': 0x94, '₽': 0x3f };

export function encodeCp1251(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const n = ch.codePointAt(0)!;
    if (n < 0x80) out.push(n);
    else if (n >= 0x410 && n <= 0x44f) out.push(n - 0x410 + 0xc0);
    else out.push(EXTRA[ch] ?? 0x3f);
  }
  return Uint8Array.from(out);
}

const ruDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

// Платёжные поручения для получателей с банковским счётом; платежи на карту в формат 1С не входят (их банк принимает таблицей).
export function buildPaymentOrders(payer: Payer, lines: PayLine[], now: Date = new Date()): { text: string; skipped: PayLine[] } {
  const skipped: PayLine[] = [];
  const docs: string[] = [];
  let n = 0;
  for (const l of lines) {
    if (!l.account || !l.bik) { skipped.push(l); continue; }
    n += 1;
    docs.push([
      'СекцияДокумент=Платежное поручение', `Номер=${n}`, `Дата=${ruDate(now)}`, `Сумма=${l.amount.toFixed(2)}`,
      `ПлательщикСчет=${payer.bank_account ?? ''}`, `Плательщик=ИНН ${payer.inn ?? ''} ${payer.name}`, `ПлательщикИНН=${payer.inn ?? ''}`,
      `ПлательщикБанк1=${payer.bank_name ?? ''}`, `ПлательщикБИК=${payer.bik ?? ''}`,
      `ПолучательСчет=${l.account}`, `Получатель=${l.worker_name}`, `ПолучательИНН=0`, `ПолучательБИК=${l.bik}`,
      `ВидПлатежа=Электронно`, `ВидОплаты=01`, `Очередность=5`, `НазначениеПлатежа=${l.purpose}`, 'КонецДокумента',
    ].join('\r\n'));
  }
  const head = [
    '1CClientBankExchange', 'ВерсияФормата=1.03', 'Кодировка=Windows', `Отправитель=${payer.name}`, `ДатаСоздания=${ruDate(now)}`,
    `ДатаНачала=${ruDate(now)}`, `ДатаКонца=${ruDate(now)}`, `РасчСчет=${payer.bank_account ?? ''}`,
  ].join('\r\n');
  return { text: [head, ...docs, 'КонецФайла'].join('\r\n') + '\r\n', skipped };
}
