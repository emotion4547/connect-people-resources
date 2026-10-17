export const ORDER_STATUSES: Record<string, string> = {
  new: 'Новый', accepted: 'Принят', in_progress: 'В работе', completed: 'Завершён', cancelled: 'Отменён',
};
export const SHIFT_STATUSES: Record<string, string> = {
  open: 'Открыта', staffed: 'Укомплектована', running: 'Идёт', completed: 'Завершена', cancelled: 'Отменена',
};
export const WEEKDAYS: { id: number; short: string }[] = [
  { id: 1, short: 'Пн' }, { id: 2, short: 'Вт' }, { id: 3, short: 'Ср' }, { id: 4, short: 'Чт' },
  { id: 5, short: 'Пт' }, { id: 6, short: 'Сб' }, { id: 7, short: 'Вс' },
];

export interface Order {
  id: string; org_id: string; client_id: string; site_id: string; position_id: string; unit: string;
  date_from: string; date_to: string; weekdays: number[] | null; dates: string[] | null;
  start_time: string; end_time: string; break_minutes: number; headcount: number; reserve_count: number;
  requirements: string | null; comment: string | null; status: string; source: string; starts_at: string | null;
}

export interface Shift {
  id: string; order_id: string; shift_date: string; start_at: string; end_at: string; headcount: number;
  reserve_count: number; status: string; published_at: string | null;
}

// Срочный: новый заказ с началом меньше чем через 24 часа (раздел 8, О-3).
export const isUrgent = (o: Pick<Order, 'status' | 'starts_at'>) =>
  o.status === 'new' && !!o.starts_at && new Date(o.starts_at).getTime() - Date.now() < 24 * 3600 * 1000;

export const fmtTime = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const fmtDateTime = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const hhmm = (t: string) => t.slice(0, 5);
