export const SITE_STATUSES: Record<string, string> = { launch: 'Запуск', active: 'Активный', paused: 'Пауза', closed: 'Закрыт' };
export const CHECKIN_METHODS: Record<string, string> = { qr: 'QR-код', geo: 'Геолокация', both: 'QR-код и геолокация', manual: 'Вручную (менеджер или бригадир)' };
export const COMMON_TIMEZONES = [
  'Asia/Yekaterinburg', 'Europe/Moscow', 'Europe/Samara', 'Asia/Omsk', 'Asia/Novosibirsk', 'Asia/Krasnoyarsk',
  'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Europe/Kaliningrad',
];

export interface Site {
  id: string; org_id: string; client_id: string | null; name: string; address: string | null; city: string | null;
  latitude: number | null; longitude: number | null; checkin_radius_m: number | null; checkin_method: string;
  status: string; instructions: string | null; contact_name: string | null; contact_phone: string | null;
  site_manager_id: string | null; qr_printed_at: string | null; required_docs_confirmed: boolean; timezone: string;
}
export interface ChecklistItem { item: string; label: string; done: boolean }
