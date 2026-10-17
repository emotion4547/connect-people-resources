export const fmtDate = (d: string | null | undefined) => (d ? d.split('-').reverse().join('.') : '—');

export const fmtMoney = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === ''
    ? '—'
    : new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', minimumFractionDigits: 2 }).format(Number(n));

export const today = () => new Date().toISOString().slice(0, 10);

export const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
