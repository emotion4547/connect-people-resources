import React, { useCallback, useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { rpc } from '@/lib/db';
import { fmtDate, fmtMoney, monthEnd, monthStart } from '@/lib/format';
import { ACCRUAL_KINDS, type Earning } from '@/lib/cabinetMeta';
import PageMeta from '@/components/PageMeta';

const WorkerEarnings: React.FC = () => {
  const { toast } = useToast();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [rows, setRows] = useState<Earning[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await rpc('worker_earnings', { _from: from, _to: to });
    setLoading(false);
    if (error) { toast({ title: 'Не удалось загрузить заработок', description: error.message, variant: 'destructive' }); return; }
    setRows(data ?? []);
  }, [from, to, toast]);

  useEffect(() => { load(); }, [load]);

  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <DashboardLayout role="worker">
      <PageMeta title="Заработок" description="Начисления по сменам" />
      <div className="max-w-2xl mx-auto space-y-4 animate-slide-up">
        <h1 className="text-2xl font-bold">Заработок</h1>
        <div className="flex flex-wrap gap-3">
          <div><Label htmlFor="e-from">С</Label><Input id="e-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="e-to">По</Label><Input id="e-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm text-muted-foreground">Итого за период</div>
            <div className="text-3xl font-bold">{fmtMoney(total)}</div>
            <p className="text-xs text-muted-foreground mt-1">Выплаты и чеки появятся позже. Сумма — после подтверждения табеля заказчиком.</p>
          </CardContent>
        </Card>
        {loading ? <p className="text-muted-foreground">Загрузка…</p> : (
          <div className="space-y-2">
            {rows.map((r) => (
              <Card key={r.accrual_id}>
                <CardContent className="pt-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{fmtDate(r.shift_date)} · {ACCRUAL_KINDS[r.kind] ?? r.kind}</div>
                    <div className="text-sm text-muted-foreground">
                      {r.site_name}{r.kind === 'main' && r.hours !== null ? ` · ${r.hours} ч` : ''}{r.reason ? ` · ${r.reason}` : ''}
                    </div>
                    {r.note && <div className="text-sm">{r.note}</div>}
                  </div>
                  <div className={`font-semibold whitespace-nowrap ${Number(r.amount) < 0 ? 'text-destructive' : ''}`}>{fmtMoney(r.amount)}</div>
                </CardContent>
              </Card>
            ))}
            {!rows.length && <p className="text-muted-foreground">Начислений за период нет.</p>}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default WorkerEarnings;
