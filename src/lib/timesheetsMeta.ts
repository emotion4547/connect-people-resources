export const TIMESHEET_STATUSES: Record<string, string> = {
  draft: 'Черновик',
  pending: 'На подтверждении',
  confirmed: 'Подтверждён',
  disputed: 'Есть споры',
  closed: 'Закрыт',
};

export const LINE_STATUSES: Record<string, string> = {
  pending: 'Ждёт подтверждения',
  confirmed: 'Подтверждена',
  disputed: 'Спор',
};

export interface Timesheet {
  id: string;
  site_id: string;
  client_id: string;
  period_from: string;
  period_to: string;
  status: keyof typeof TIMESHEET_STATUSES;
  sent_at: string | null;
  confirm_deadline: string | null;
  confirmed_at: string | null;
  confirmed_auto: boolean;
}

export interface TimesheetLine {
  assignment_id: string;
  shift_date: string;
  worker_id: string;
  worker_name: string;
  position_name: string;
  planned_hours: number | null;
  check_in_at: string | null;
  check_out_at: string | null;
  approved_hours: number | null;
  late_minutes: number;
  manual_in: boolean;
  manual_out: boolean;
  auto_out: boolean;
  overtime_hours: number;
  overtime_approved_hours: number;
  line_status: 'pending' | 'confirmed' | 'disputed' | null;
  dispute_id: string | null;
  dispute_status: 'open' | 'accepted' | 'rejected' | null;
  dispute_proposed: number | null;
}

export const hm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—';

export const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export const HOURS_MODES: Record<string, string> = {
  schedule: 'По графику',
  actual: 'По факту',
};
