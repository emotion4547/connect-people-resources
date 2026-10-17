export interface ImportColumn { key: string; header: string; required?: boolean; example: string; aliases?: string[]; map?: Record<string, string>; hint?: string }
export interface ImportEntity { id: string; module: string; title: string; description: string; columns: ImportColumn[] }

const TAX = { 'ип': 'ip', 'самозанятый': 'self_employed', 'самозанятая': 'self_employed', 'гпх': 'gph', 'трудовой': 'employment', 'трудовой договор': 'employment', 'ip': 'ip', 'self_employed': 'self_employed', 'gph': 'gph', 'employment': 'employment' };

export const IMPORT_ENTITIES: ImportEntity[] = [
  {
    id: 'candidates', module: 'candidates', title: 'Исполнители и кандидаты',
    description: 'Люди попадают в раздел «Кандидаты» с источником «Импорт из Excel» и дальше проходят обычный допуск. Дубли определяются по телефону; те, кто уже стал исполнителем, пропускаются.',
    columns: [
      { key: 'full_name', header: 'ФИО', required: true, example: 'Иванов Иван Иванович', aliases: ['фио', 'имя', 'фамилия имя отчество'] },
      { key: 'phone', header: 'Телефон', required: true, example: '+7 900 123-45-67', aliases: ['тел', 'номер телефона'] },
      { key: 'city', header: 'Город', example: 'Оренбург' },
      { key: 'district', header: 'Район', example: 'Ленинский' },
      { key: 'citizenship', header: 'Гражданство', example: 'РФ' },
      { key: 'experience', header: 'Опыт', example: 'Грузчик, 2 года' },
      { key: 'birth_date', header: 'Дата рождения', example: '15.03.1990', aliases: ['дата рожд', 'др'] },
      { key: 'tax_status', header: 'Налоговый статус', example: 'самозанятый', hint: 'ИП, самозанятый, ГПХ или трудовой договор', aliases: ['статус', 'форма найма'], map: TAX },
    ],
  },
  {
    id: 'clients', module: 'clients', title: 'Заказчики',
    description: 'Дубли определяются по ИНН, а без ИНН — по названию. Заказчик закрепляется за менеджером, который загружает файл.',
    columns: [
      { key: 'name', header: 'Название', required: true, example: 'ООО Склад-Сервис', aliases: ['заказчик', 'компания', 'наименование'] },
      { key: 'legal_name', header: 'Юридическое название', example: 'Общество с ограниченной ответственностью «Склад-Сервис»' },
      { key: 'inn', header: 'ИНН', example: '5612345678' },
      { key: 'kpp', header: 'КПП', example: '561201001' },
      { key: 'legal_address', header: 'Юридический адрес', example: 'г. Оренбург, ул. Складская, 1', aliases: ['адрес'] },
      { key: 'city', header: 'Город', example: 'Оренбург' },
      { key: 'status', header: 'Статус', example: 'активный', hint: 'лид, переговоры, договор, активный или пауза', map: { 'лид': 'lead', 'переговоры': 'negotiation', 'договор': 'contract', 'активный': 'active', 'пауза': 'paused', 'lead': 'lead', 'negotiation': 'negotiation', 'contract': 'contract', 'active': 'active', 'paused': 'paused' } },
      { key: 'notes', header: 'Заметка', example: '' },
    ],
  },
  {
    id: 'sites', module: 'sites', title: 'Объекты',
    description: 'Заказчик указывается названием и должен быть загружен раньше. Объекты создаются на запуске: проверки и запуск — в разделе «Объекты».',
    columns: [
      { key: 'client', header: 'Заказчик', required: true, example: 'ООО Склад-Сервис' },
      { key: 'name', header: 'Название объекта', required: true, example: 'Склад Север', aliases: ['объект', 'название'] },
      { key: 'address', header: 'Адрес', example: 'г. Оренбург, ул. Складская, 1' },
      { key: 'city', header: 'Город', example: 'Оренбург' },
      { key: 'latitude', header: 'Широта', example: '51.7682' },
      { key: 'longitude', header: 'Долгота', example: '55.0970' },
      { key: 'checkin_method', header: 'Способ отметки', example: 'геолокация', hint: 'QR, геолокация, оба или вручную', map: { 'qr': 'qr', 'геолокация': 'geo', 'гео': 'geo', 'оба': 'both', 'вручную': 'manual', 'geo': 'geo', 'both': 'both', 'manual': 'manual' } },
      { key: 'status', header: 'Статус', example: '', hint: 'запуск, активный или пауза (активный — только руководитель)', map: { 'запуск': 'launch', 'активный': 'active', 'пауза': 'paused', 'launch': 'launch', 'active': 'active', 'paused': 'paused' } },
      { key: 'contact_name', header: 'Контакт на объекте', example: 'Пётр Сидоров', aliases: ['контакт'] },
      { key: 'contact_phone', header: 'Телефон контакта', example: '+7 900 765-43-21' },
      { key: 'instructions', header: 'Как пройти', example: 'КПП №2, пропуск на фамилию', aliases: ['инструкции'] },
    ],
  },
  {
    id: 'tariffs', module: 'tariffs', title: 'Тарифы',
    description: 'Тарифы создаются черновиками: утвердить их нужно в карточке заказчика. Заказчик, объект и позиция указываются названиями.',
    columns: [
      { key: 'client', header: 'Заказчик', required: true, example: 'ООО Склад-Сервис' },
      { key: 'site', header: 'Объект', example: 'Склад Север', hint: 'пусто — тариф на все объекты заказчика' },
      { key: 'position', header: 'Позиция', required: true, example: 'Грузчик' },
      { key: 'unit', header: 'Единица', example: 'час', hint: 'час, смена или штука', map: { 'час': 'hour', 'смена': 'shift', 'штука': 'piece', 'шт': 'piece', 'hour': 'hour', 'shift': 'shift', 'piece': 'piece' } },
      { key: 'client_rate', header: 'Ставка заказчику', required: true, example: '450', aliases: ['ставка клиента'] },
      { key: 'worker_rate', header: 'Ставка исполнителю', required: true, example: '300', aliases: ['ставка на руки'] },
      { key: 'valid_from', header: 'Действует с', required: true, example: '01.11.2026', aliases: ['с даты', 'дата начала'] },
    ],
  },
];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export const matchColumn = (header: string, entity: ImportEntity): ImportColumn | undefined => {
  const h = norm(header);
  return entity.columns.find((c) => norm(c.header) === h || norm(c.key) === h || (c.aliases ?? []).some((a) => norm(a) === h));
};

// Ячейка → строка для сервера: даты Excel — в ISO, числа без экспоненты, русские слова — в коды.
export const cellToValue = (v: unknown, col: ImportColumn): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  let s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : String(v).trim();
  if (col.map) { const m = col.map[norm(s)]; if (m) s = m; }
  return s;
};

export const templateCsvRows = (e: ImportEntity): { header: string[]; rows: string[][] } => ({ header: e.columns.map((c) => c.header), rows: [e.columns.map((c) => c.example)] });

// Разбор CSV из Excel («;», «,» или табуляция, кавычки).
export function parseCsv(text: string): string[][] {
  const t = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const first = t.split(/\r?\n/, 1)[0] ?? '';
  const delim = [';', '\t', ','].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export const decodeCsvBytes = (bytes: ArrayBuffer): string => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('windows-1251').decode(bytes); }
};
