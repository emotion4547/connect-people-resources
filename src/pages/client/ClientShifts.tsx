import React, { useCallback, useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db, rpc } from '@/lib/db';
import { addDays, today } from '@/lib/format';
import { dateLong, timeIn, type ClientShift } from '@/lib/cabinetMeta';
import { SHIFT_STATUSES } from '@/lib/ordersMeta';
import PageMeta from '@/components/PageMeta';

// К-3: календарь смен с укомплектованностью. Уменьшить число людей или отменить смену можно, пока она не началась;
// позднюю отмену считает договор.
const ClientShifts: React.FC = () => {
  const { toast } = useToast();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(addDays(today(), 13));
  const [rows, setRows] = useState<ClientShift[]>([]);
  const [reasons, setReasons] = useState<{ id: string; name: string }[]>([]);
  const [cancelFor, setCancelFor] = useState<ClientShift | null>(null);
  const [reduceFor, setReduceFor] = useState<ClientShift | null>(null);
  const [reasonId, setReasonId] = useState('');
  const [count, setCount] = useState('1');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await rpc('client_shifts', { _from: from, _to: to });
    if (error) { toast({ title: 'Не удалось загрузить смены', description: error.message, variant: 'destructive' }); return; }
    setRows(data ?? []);
  }, [from, to, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    db('directories').select('id,name').eq('kind', 'cancel_reason').eq('is_active', true).order('sort_order')
      .then(({ data }: { data: { id: string; name: string }[] | null }) => setReasons(data ?? []));
  }, []);

  const run = async (fn: () => Promise<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return false; }
    toast({ title: ok });
    await load();
    return true;
  };

  const days = Array.from(new Set(rows.map((r) => r.shift_date)));
  const editable = (s: ClientShift) => ['open', 'staffed'].includes(s.status) && new Date(s.start_at) > new Date();

  return (
    <DashboardLayout role="hr">
      <PageMeta title="Смены" description="Календарь смен и укомплектованность" />
      <div className="max-w-3xl mx-auto space-y-4 animate-slide-up">
        <h1 className="text-2xl font-bold">Смены</h1>
        <div className="flex flex-wrap gap-3">
          <div><Label htmlFor="cs-from">С</Label><Input id="cs-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="cs-to">По</Label><Input id="cs-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        {days.map((d) => (
          <section key={d} className="space-y-2">
            <h2 className="font-semibold">{dateLong(d)}</h2>
            {rows.filter((r) => r.shift_date === d).map((s) => (
              <Card key={s.shift_id}>
                <CardContent className="pt-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">{s.site_name} · {s.position_name}</div>
                    <div className="text-sm text-muted-foreground">{timeIn(s.start_at, s.timezone)}–{timeIn(s.end_at, s.timezone)} · укомплектовано {s.assigned_count} из {s.headcount}, подтвердили {s.confirmed_count}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.status === 'cancelled' ? 'destructive' : 'secondary'}>{SHIFT_STATUSES[s.status] ?? s.status}</Badge>
                    {editable(s) && s.headcount > 1 && <Button size="sm" variant="outline" onClick={() => { setReduceFor(s); setCount(String(s.headcount - 1)); }}>Уменьшить</Button>}
                    {editable(s) && <Button size="sm" variant="outline" onClick={() => { setCancelFor(s); setReasonId(''); }}>Отменить</Button>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </section>
        ))}
        {!rows.length && <p className="text-muted-foreground">Смен за период нет.</p>}
      </div>

      <Dialog open={!!cancelFor} onOpenChange={(o) => !o && setCancelFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отменить смену</DialogTitle>
            <DialogDescription>Если отмена позже срока из договора, может быть начислена оплата части смены.</DialogDescription>
          </DialogHeader>
          <Select value={reasonId} onValueChange={setReasonId}>
            <SelectTrigger aria-label="Причина"><SelectValue placeholder="Причина" /></SelectTrigger>
            <SelectContent>{reasons.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelFor(null)}>Назад</Button>
            <Button disabled={!reasonId || busy}
              onClick={async () => { if (cancelFor && await run(() => rpc('client_cancel_shift', { _shift_id: cancelFor.shift_id, _reason_id: reasonId }), 'Смена отменена')) setCancelFor(null); }}>
              Отменить смену
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reduceFor} onOpenChange={(o) => !o && setReduceFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Уменьшить число людей</DialogTitle>
            <DialogDescription>Сейчас {reduceFor?.headcount}. Лишние исполнители будут сняты со смены.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="rd-count">Сколько людей нужно</Label>
          <Input id="rd-count" type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReduceFor(null)}>Назад</Button>
            <Button disabled={busy}
              onClick={async () => { if (reduceFor && await run(() => rpc('client_reduce_shift', { _shift_id: reduceFor.shift_id, _headcount: Number(count) }), 'Число людей уменьшено')) setReduceFor(null); }}>
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default ClientShifts;
