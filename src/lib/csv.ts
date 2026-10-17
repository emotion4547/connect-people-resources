// Выгрузка таблицы в CSV, который открывается в Excel: разделитель «;», запятая в числах, BOM для кириллицы.
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : (v ?? '').toString();
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Выгрузка в настоящий файл Excel (.xlsx): числа остаются числами, заголовок выделен, ширина столбцов по содержимому.
// Библиотека подгружается только при выгрузке.
export async function downloadExcel(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const cell = (v: string | number | null | undefined) =>
    typeof v === 'number' && Number.isFinite(v) ? { value: v, type: Number } : { value: v === null || v === undefined ? '' : String(v), type: String };
  const data = [header.map((h) => ({ value: h, type: String, fontWeight: 'bold' as const })), ...rows.map((r) => r.map(cell))];
  const columns = header.map((h, i) => ({ width: Math.min(60, Math.max(10, h.length + 2, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))) }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (writeXlsxFile as any)(data, { columns }).toFile(filename.endsWith('.xlsx') ? filename : filename.replace(/\.csv$/, '') + '.xlsx');
}
