import React, { useEffect, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { rpc } from '@/lib/db';
import { fmtMoney } from '@/lib/format';
import { TAX_STATUS_LABELS } from '@/lib/clientsMeta';

interface MarginRow { status: string; taxes: number; payout_fee: number; cost: number; margin: number; margin_pct: number | null }

// Маржа по каждому налоговому статусу исполнителя (П-8). Считает база, а не браузер:
// формулы и ставки живут в одном месте.
export const MarginCalculator: React.FC<{ orgId: string; clientRate: string; workerRate: string; at: string }> = ({ orgId, clientRate, workerRate, at }) => {
  const [rows, setRows] = useState<MarginRow[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const c = Number(clientRate.replace(',', '.'));
    const w = Number(workerRate.replace(',', '.'));
    if (!Number.isFinite(c) || !Number.isFinite(w) || c <= 0 || w < 0) { setRows([]); return; }
    const timer = setTimeout(async () => {
      const { data, error: err } = await rpc('calc_margins', { _org_id: orgId, _client_rate: c, _worker_rate: w, _at: at });
      if (err) { setError(err.message); setRows([]); } else { setError(''); setRows(data ?? []); }
    }, 300);
    return () => clearTimeout(timer);
  }, [orgId, clientRate, workerRate, at]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">Введите ставки, чтобы увидеть маржу.</p>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Статус исполнителя</TableHead><TableHead>Налоги и комиссия</TableHead><TableHead>Себестоимость</TableHead>
          <TableHead>Маржа</TableHead><TableHead>Маржа, %</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.status}>
            <TableCell>{TAX_STATUS_LABELS[r.status] ?? r.status}</TableCell>
            <TableCell>{fmtMoney(Number(r.taxes) + Number(r.payout_fee))}</TableCell>
            <TableCell>{fmtMoney(r.cost)}</TableCell>
            <TableCell className={r.margin < 0 ? 'text-destructive' : ''}>{fmtMoney(r.margin)}</TableCell>
            <TableCell className={Number(r.margin_pct) < 0 ? 'text-destructive' : ''}>{r.margin_pct ?? '—'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
