export const CHANNELS: Record<string, string> = { bank_account: 'Банковский счёт', bank_card: 'Банковская карта', platform: 'Платформа самозанятых' };
export const NPD_STATUSES: Record<string, string> = { unknown: 'Не проверялся', active: 'Является плательщиком НПД', inactive: 'Снят с учёта' };

export const REGISTRY_STATUSES: Record<string, string> = {
  composed: 'Сформирован', confirmed: 'Подтверждён', sent: 'Отправлен', paid_partial: 'Проведён частично', paid: 'Проведён', errors: 'Есть ошибки', cancelled: 'Аннулирован',
};
export const REGISTRY_KINDS: Record<string, string> = { payment: 'Выплата', advance: 'Аванс' };
export const REGISTRY_CHANNELS: Record<string, string> = { bank: 'Банк', platform: 'Платформа самозанятых' };
export const LINE_STATUSES: Record<string, string> = { pending: 'Ожидает', paid: 'Проведена', error: 'Ошибка', cancelled: 'Снята' };
export const ADVANCE_STATUSES: Record<string, string> = {
  requested: 'Запрошен', approved: 'Согласован', in_registry: 'В реестре', issued: 'Выдан', repaid: 'Погашен', rejected: 'Отклонён', cancelled: 'Отменён',
};

export interface Registry {
  id: string; org_id: string; batch_id: string; number: string | null; kind: string; channel: string; period_from: string; period_to: string;
  status: string; total_amount: number; lines_count: number; created_by: string | null; confirmed_by: string | null; confirmed_at: string | null; cancel_reason: string | null;
  created_at: string;
}
export interface RegistryLine {
  id: string; worker_id: string; worker_name: string; tax_status: string | null; gross: number; advance_held: number; ndfl: number; contributions: number;
  amount_to_pay: number; requisites_masked: string | null; status: string; error_text: string | null; receipt: string | null;
}
export interface Exclusion { id: string; batch_id: string; worker_id: string; worker_name: string; kind: string; amount: number; reasons: string[]; created_at: string }
