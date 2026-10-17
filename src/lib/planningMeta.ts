export const ASSIGNMENT_STATUSES: Record<string, string> = {
  responded: 'Откликнулся', invited: 'Приглашён', assigned: 'Назначен', confirmed: 'Подтвердил выход', on_site: 'На месте',
  worked: 'Отработал', no_show: 'Не вышел', cancelled_worker: 'Отменил исполнитель', cancelled_manager: 'Отменил менеджер',
  removed_by_client: 'Снят заказчиком', rejected: 'Отклонён',
};
// Статусы, при которых человек занимает место на смене.
export const ACTIVE_ASSIGNMENT = ['assigned', 'confirmed', 'on_site', 'worked'];

export interface StaffingRow {
  shift_id: string; org_id: string; order_id: string; client_id: string; site_id: string; position_id: string;
  shift_date: string; start_at: string; end_at: string; headcount: number; reserve_count: number; status: string;
  published_at: string | null; assigned_count: number; confirmed_count: number; on_site_count: number;
  reserve_count_taken: number; responses_count: number;
}

// Цвет ячейки сетки (О-7): красный — не хватает, жёлтый — есть неподтвердившие, зелёный — укомплектовано.
export function staffingColor(r: Pick<StaffingRow, 'headcount' | 'assigned_count' | 'confirmed_count' | 'status'>): 'red' | 'yellow' | 'green' | 'grey' {
  if (r.status === 'cancelled') return 'grey';
  if (r.assigned_count < r.headcount) return 'red';
  if (r.confirmed_count < r.headcount) return 'yellow';
  return 'green';
}

export const COLOR_CLASSES: Record<string, string> = {
  red: 'bg-red-100 text-red-900 border-red-300 dark:bg-red-950 dark:text-red-100',
  yellow: 'bg-yellow-100 text-yellow-900 border-yellow-300 dark:bg-yellow-950 dark:text-yellow-100',
  green: 'bg-green-100 text-green-900 border-green-300 dark:bg-green-950 dark:text-green-100',
  grey: 'bg-muted text-muted-foreground border-border line-through',
};

export const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
};
