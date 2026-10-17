export const DOC_KINDS: Record<string, string> = {
  invoice: 'Счёт на оплату', act: 'Акт оказанных услуг', upd: 'УПД', reconciliation: 'Акт сверки',
};

export const DOC_STATUSES: Record<string, string> = {
  draft: 'Черновик', issued: 'Выставлен', signed: 'Подписан', paid_partial: 'Оплачен частично', paid: 'Оплачен', cancelled: 'Аннулирован',
};

export interface ClientDocument {
  id: string; org_id: string; kind: string; client_id: string; contract_id: string | null; parent_document_id: string | null;
  number: string | null; issue_date: string | null; period_from: string; period_to: string; due_date: string | null; status: string;
  amount_net: number; vat_rate: number; vat_amount: number; amount_total: number; has_open_timesheets: boolean;
  sent_at: string | null; signed_at: string | null; sign_method: string | null; cancel_reason: string | null;
}

export interface DocumentLine {
  id: string; line_kind: string; site_name: string | null; position_name: string | null; unit: string | null;
  quantity: number; rate: number; amount: number; note: string | null; sort_order: number;
}

export const UNIT_LABELS: Record<string, string> = { hour: 'ч', shift: 'смена', piece: 'шт', service: 'усл.' };

export const docTitle = (d: Pick<ClientDocument, 'kind' | 'number' | 'issue_date'>) =>
  d.number ? `${DOC_KINDS[d.kind]} № ${d.number}` : `${DOC_KINDS[d.kind]} (черновик)`;
