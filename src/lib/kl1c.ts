// Разбор банковской выписки в формате обмена с 1С (kl_to_1c.txt). Нужны только входящие платежи: те, что пришли
// на наш расчётный счёт. Файл обычно в кодировке Windows-1251, иногда DOS (866) или UTF-8.

export interface ParsedPayment { date: string; amount: number; number: string; payer_name: string; payer_inn: string; purpose: string }
export interface ParsedOutgoing { date: string; amount: number; number: string; recipient_name: string; recipient_inn: string; purpose: string }
export interface ParsedStatement { account: string; payments: ParsedPayment[]; outgoing: ParsedOutgoing[]; skipped: number }

export function decodeStatement(bytes: ArrayBuffer): string {
  const win = new TextDecoder('windows-1251').decode(bytes);
  const enc = /Кодировка=(\S+)/i.exec(win)?.[1]?.toLowerCase() ?? '';
  if (enc.startsWith('dos')) return new TextDecoder('ibm866').decode(bytes);
  if (enc.startsWith('utf')) return new TextDecoder('utf-8').decode(bytes);
  return win;
}

const isoDate = (d: string) => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

export function parseStatement(text: string): ParsedStatement {
  const lines = text.split(/\r?\n/);
  let account = '';
  let cur: Record<string, string> | null = null;
  const docs: Record<string, string>[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('СекцияДокумент')) { cur = {}; continue; }
    if (line === 'КонецДокумента') { if (cur) docs.push(cur); cur = null; continue; }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    if (cur) cur[key] = value;
    else if (key === 'РасчСчет' && !account) account = value.trim();
  }
  const payments: ParsedPayment[] = [];
  const outgoing: ParsedOutgoing[] = [];
  let skipped = 0;
  for (const d of docs) {
    // Входящий платёж: получатель — наш счёт (или проставлена дата поступления).
    const outgo = !!account && (d['ПлательщикСчет'] ?? '').trim() === account && (d['ПолучательСчет'] ?? '').trim() !== account;
    if (outgo) {
      const amt = Number((d['Сумма'] ?? '').replace(/\s/g, '').replace(',', '.'));
      const dt = isoDate(d['ДатаСписано'] || d['Дата'] || '');
      if (dt && amt > 0) {
        outgoing.push({ date: dt, amount: amt, number: (d['Номер'] ?? '').trim(), recipient_inn: (d['ПолучательИНН'] ?? '').trim(), recipient_name: (d['Получатель1'] || (d['Получатель'] ?? '').replace(/^ИНН\s*\d*\s*/i, '')).trim(), purpose: (d['НазначениеПлатежа'] ?? '').trim() });
      } else skipped++;
      continue;
    }
    const incoming = d['ПолучательСчет'] ? d['ПолучательСчет'].trim() === account : !!d['ДатаПоступления'];
    const amount = Number((d['Сумма'] ?? '').replace(/\s/g, '').replace(',', '.'));
    const date = isoDate(d['ДатаПоступления'] || d['Дата'] || '');
    if (!incoming || !date || !(amount > 0)) { skipped++; continue; }
    payments.push({
      date, amount, number: (d['Номер'] ?? '').trim(),
      payer_name: (d['Плательщик1'] || d['Плательщик'] || '').trim(), payer_inn: (d['ПлательщикИНН'] ?? '').trim(),
      purpose: (d['НазначениеПлатежа'] ?? '').trim(),
    });
  }
  return { account, payments, outgoing, skipped };
}

// Все строки выписки в виде операций ДДС: поступления и расходы с контрагентом, его ИНН и назначением.
export interface StatementRow { date: string; direction: 'in' | 'out'; amount: number; number: string; counterparty_name: string; counterparty_inn: string; purpose: string }

export function statementRows(p: ParsedStatement): StatementRow[] {
  return [
    ...p.payments.map((x) => ({ date: x.date, direction: 'in' as const, amount: x.amount, number: x.number, counterparty_name: x.payer_name, counterparty_inn: x.payer_inn, purpose: x.purpose })),
    ...p.outgoing.map((x) => ({ date: x.date, direction: 'out' as const, amount: x.amount, number: x.number, counterparty_name: x.recipient_name, counterparty_inn: x.recipient_inn, purpose: x.purpose })),
  ];
}
