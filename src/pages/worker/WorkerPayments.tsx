import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { rpc } from '@/lib/db';
import { addDays, fmtDate, fmtMoney, today } from '@/lib/format';
import PageMeta from '@/components/PageMeta';

interface Payout { line_id: string; registry_number: string; kind: string; planned_on: string; paid_at: string | null; amount: number; advance_held: number; status: string; receipt: string | null; error_text: string | null }

const STATUS: Record<string, string> = { pending: 'В обработке', paid: 'Выплачено', error: 'Не прошла' };

// И-4: выплаты исполнителя — дата, сумма, статус, чек НПД; справка о заработке за период.
const WorkerPayments: React.FC = () => {
  const { toast } = useToast();
  const [from, setFrom] = useState(addDays(today(), -180));
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState<Payout[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await rpc('worker_payouts', { _from: from, _to: addDays(to, 30) });
    if (error) { toast({ title: 'Не удалось загрузить выплаты', description: error.message, variant: 'destructive' }); return; }
    setRows(data ?? []);
  }, [from, to, toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <DashboardLayout role="worker">
      <PageMeta title="Выплаты" description="Выплаты и справка о заработке" />
      <div className="max-w-2xl mx-auto space-y-4 animate-slide-up">
        <h1 className="text-2xl font-bold">Выплаты</h1>
        <div className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="pp-from">С</Label><Input id="pp-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="pp-to">По</Label><Input id="pp-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button asChild variant="outline"><Link to={`/worker/certificate?from=${from}&to=${to}`}>Справка о заработке</Link></Button>
        </div>
        {rows.map((r) => (
          <Card key={r.line_id}>
            <CardContent className="pt-4 flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{r.paid_at ? fmtDate(r.paid_at.slice(0, 10)) : `Период по ${fmtDate(r.planned_on)}`} · {r.kind === 'advance' ? 'Аванс' : 'Выплата'}</div>
                <div className="text-sm text-muted-foreground">Реестр {r.registry_number}{Number(r.advance_held) ? ` · удержан аванс ${fmtMoney(r.advance_held)}` : ''}</div>
                {r.receipt && <a className="text-sm underline" href={r.receipt} target="_blank" rel="noreferrer">Чек</a>}
                {r.error_text && <div className="text-sm text-destructive">{r.error_text}</div>}
              </div>
              <div className="text-right">
                <div className="font-semibold">{fmtMoney(r.amount)}</div>
                <Badge variant={r.status === 'error' ? 'destructive' : r.status === 'paid' ? 'default' : 'secondary'}>{STATUS[r.status]}</Badge>
              </div>
            </CardContent>
          </Card>
        ))}
        {!rows.length && <p className="text-muted-foreground">Выплат за период нет.</p>}
      </div>
    </DashboardLayout>
  );
};

export default WorkerPayments;
