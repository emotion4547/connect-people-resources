// Разбор банковской выписки в формате обмена с 1С (kl_to_1c.txt). Нужны только входящие платежи: те, что пришли
// на наш расчётный счёт. Файл обычно в кодировке Windows-1251, иногда DOS (866) или UTF-8.

export interface ParsedPayment { date: string; amount: number; number: string; payer_name: string; payer_inn: string; purpose: string }
export interface ParsedStatement { account: string; payments: ParsedPayment[]; skipped: number }

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
  let skipped = 0;
  for (const d of docs) {
    // Входящий платёж: получатель — наш счёт (или проставлена дата поступления).
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
  return { account, payments, skipped };
}
