export const DEAL_STAGES: { id: string; label: string; probability: number }[] = [
  { id: 'new', label: 'Новая', probability: 10 },
  { id: 'qualification', label: 'Квалификация', probability: 25 },
  { id: 'proposal', label: 'КП отправлено', probability: 40 },
  { id: 'negotiation', label: 'Переговоры', probability: 60 },
  { id: 'contract', label: 'Договор', probability: 80 },
];

export const stageLabel = (id: string) => (id === 'won' ? 'Выиграна' : id === 'lost' ? 'Проиграна' : DEAL_STAGES.find((s) => s.id === id)?.label ?? id);

export const TOUCH_KINDS: Record<string, string> = { call: 'Звонок', meeting: 'Встреча', email: 'Письмо', task: 'Задача' };

export const SOURCES: Record<string, string> = { manual: 'Вручную', site_form: 'Форма на сайте', self_registration: 'Саморегистрация HR' };

export const LOST_REASONS = ['Дорого', 'Выбрали другого подрядчика', 'Нет потребности', 'Не вышли на связь', 'Не подошли условия оплаты', 'Не готовы к аутсорсингу'];

export interface Deal {
  id: string; org_id: string; client_id: string | null; title: string; company: string | null; contact_name: string | null; contact_phone: string | null; contact_email: string | null;
  source: string; stage: string; owner_id: string | null; expected_revenue: number; expected_margin: number; next_step: string | null; next_step_date: string | null;
  expected_close: string | null; lost_reason: string | null; note: string | null; won_at: string | null; closed_at: string | null; last_touch_at: string | null; created_at: string;
}
export interface QuoteLine { position_id: string; unit: string; client_rate: number; worker_rate: number; headcount: number; hours_per_month: number }
export interface Quote { id: string; deal_id: string; version: number; lines: QuoteLine[]; valid_until: string | null; note: string | null; sent_at: string | null; sent_to: string | null; created_at: string }
