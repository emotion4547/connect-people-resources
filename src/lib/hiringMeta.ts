export const STAGES: { id: string; label: string; side?: boolean }[] = [
  { id: 'new', label: 'Новый' },
  { id: 'contacted', label: 'Связались' },
  { id: 'interview', label: 'Собеседование' },
  { id: 'documents', label: 'Документы' },
  { id: 'admitted', label: 'Допущен' },
  { id: 'no_answer', label: 'Не дозвонились', side: true },
  { id: 'reserve', label: 'Резерв', side: true },
  { id: 'rejected', label: 'Отказ', side: true },
];
export const STAGE_LABELS: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.id, s.label]));

export const ACTIVITY_KINDS: Record<string, string> = { call: 'Звонок', message: 'Сообщение', meeting: 'Встреча', note: 'Заметка' };
export const DOC_STATUSES: Record<string, string> = { uploaded: 'Загружен', verified: 'Проверен', rejected: 'Отклонён' };
export const WORKER_STATUSES: Record<string, string> = {
  active: 'Активен', sick: 'Больничный', vacation: 'Отпуск', blocked: 'Заблокирован', not_working: 'Не работает',
};

export interface Candidate {
  id: string; org_id: string; full_name: string; phone: string | null; city: string | null; district: string | null;
  citizenship: string | null; experience: string | null; birth_date: string | null; tax_status: string | null;
  source_id: string | null; referrer_id: string | null; recruiter_id: string | null; stage: string; stage_changed_at: string;
  reject_reason_id: string | null; next_contact_at: string | null; next_contact_note: string | null;
  admitted_worker_id: string | null; created_at: string;
}

export const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
