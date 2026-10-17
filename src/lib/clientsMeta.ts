export const CLIENT_STATUSES: Record<string, string> = {
  lead: 'Лид',
  negotiation: 'Переговоры',
  contract: 'Договор',
  active: 'Активный',
  paused: 'Пауза',
  archived: 'Архив',
};

export const UNITS: Record<string, string> = { hour: 'час', shift: 'смена', piece: 'штука' };
export const BILLING_PERIODS: Record<string, string> = { week: 'неделя', two_weeks: '2 недели', month: 'месяц' };
export const CONTRACT_STATUSES: Record<string, string> = { draft: 'Черновик', active: 'Действует', terminated: 'Расторгнут' };
export const TARIFF_STATUSES: Record<string, string> = {
  draft: 'Черновик', pending: 'На согласовании', approved: 'Утверждён', closed: 'Закрыт',
};
export const TAX_STATUS_LABELS: Record<string, string> = {
  ip: 'ИП', self_employed: 'Самозанятый', gph: 'ГПХ', employment: 'Трудовой',
};

export interface StaffOption { user_id: string; full_name: string; department: string }
