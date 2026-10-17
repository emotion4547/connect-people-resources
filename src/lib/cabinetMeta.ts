export interface MyShift {
  assignment_id: string; shift_id: string; status: string; is_reserve: boolean; shift_date: string; start_at: string; end_at: string;
  timezone: string; site_name: string; address: string | null; latitude: number | null; longitude: number | null;
  instructions: string | null; contact_name: string | null; position_name: string; worker_rate: number | null;
  planned_hours: number; est_earnings: number | null; check_in_at: string | null; check_out_at: string | null;
  checkin_method: string; approved_hours: number | null; can_check_in: boolean; can_cancel_free: boolean;
}

export interface OpenShift {
  shift_id: string; shift_date: string; start_at: string; end_at: string; timezone: string; site_name: string; address: string | null;
  position_id: string; position_name: string; worker_rate: number | null; est_earnings: number | null; free_places: number; overlaps: boolean;
}

export interface Earning {
  accrual_id: string; shift_date: string; site_name: string; kind: string; hours: number | null; amount: number; reason: string | null; note: string | null;
}

export const ACCRUAL_KINDS: Record<string, string> = {
  main: 'Смена', bonus: 'Бонус', deduction: 'Удержание', client_penalty: 'Штраф заказчику', correction: 'Корректировка',
};

// Статус назначения для исполнителя простыми словами.
export const MY_STATUS: Record<string, string> = {
  responded: 'Отклик отправлен', invited: 'Приглашение', assigned: 'Назначена', confirmed: 'Выход подтверждён',
  on_site: 'На месте', worked: 'Отработана', no_show: 'Не вышел',
};

export const mapsLink = (lat: number | null, lon: number | null, address: string | null) =>
  lat !== null && lon !== null
    ? `https://yandex.ru/maps/?rtext=~${lat},${lon}&rtt=auto`
    : `https://yandex.ru/maps/?text=${encodeURIComponent(address ?? '')}`;

export const timeIn = (iso: string, tz: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz });

export const dateLong = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' });

export interface ClientShift {
  shift_id: string; order_id: string; client_id: string; site_id: string; site_name: string; position_name: string; shift_date: string;
  start_at: string; end_at: string; timezone: string; status: string; headcount: number;
  assigned_count: number; confirmed_count: number; on_site_count: number;
}

export interface ClientTariff {
  client_id: string; site_id: string | null; site_name: string | null; position_id: string; position_name: string; unit: string;
  client_rate: number; night_coef: number; holiday_coef: number; min_paid_hours: number; valid_from: string; valid_to: string | null;
}
