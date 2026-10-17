export const ACCOUNT_KINDS: Record<string, string> = { bank: 'Расчётный счёт', cash: 'Касса', platform: 'Платформа выплат' };
export const BDR_ARTICLES: Record<string, string> = {
  revenue: 'Выручка', worker_costs: 'Затраты на исполнителей', worker_taxes: 'Налоги и взносы по исполнителям', payout_fees: 'Комиссии выплат',
  other_staff_costs: 'Прочие расходы на персонал', admin_costs: 'Управленческие расходы', usn_tax: 'Налог по УСН',
};

export interface CashAccount { id: string; kind: string; name: string; bank_name: string | null; account_number: string | null; opening_balance: number; opening_date: string; is_active: boolean }
export interface CashCategory { id: string; code: string | null; name: string; direction: 'in' | 'out' | 'both'; bdr_article: string | null; is_transfer: boolean; is_system: boolean; is_active: boolean }
export interface CashEntry {
  id: string; account_id: string; entry_date: string; direction: 'in' | 'out'; amount: number; category_id: string | null; counterparty: string | null;
  source: string; basis_type: string | null; transfer_group: string | null; is_advance: boolean; file_path: string | null; comment: string | null;
}
