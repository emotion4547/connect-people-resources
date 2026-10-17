import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { rpc } from '@/lib/db';
import { addDays, fmtMoney, today } from '@/lib/format';
import { dateLong, timeIn, type OpenShift } from '@/lib/cabinetMeta';
import PageMeta from '@/components/PageMeta';

const ALL = 'all';

const WorkerOpenShifts: React.FC = () => {
  const { toast } = useToast();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(addDays(today(), 14));
  const [position, setPosition] = useState(ALL);
  const [rows, setRows] = useState<OpenShift[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await rpc('worker_open_shifts', { _from: from, _to: to });
    setLoading(false);
    if (error) { toast({ title: 'Не удалось загрузить смены', description: error.message, variant: 'destructive' }); return; }
    setRows(data ?? []); setPicked([]);
  }, [from, to, toast]);

  useEffect(() => { load(); }, [load]);

  const positions = useMemo(() => Array.from(new Map(rows.map((r) => [r.position_id, r.position_name])).entries()), [rows]);
  const shown = rows.filter((r) => position === ALL || r.position_id === position);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const send = async () => {
    setBusy(true);
    const { data, error } = await rpc('respond_to_shifts', { _shift_ids: picked });
    setBusy(false);
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `Откликов отправлено: ${data}`, description: 'Менеджер подтвердит выход.' });
    load();
  };

  return (
    <DashboardLayout role="worker">
      <PageMeta title="Открытые смены" description="Смены, на которые можно откликнуться" />
      <div className="max-w-2xl mx-auto space-y-4 animate-slide-up">
        <h1 className="text-2xl font-bold">Открытые смены</h1>
        <div className="flex flex-wrap gap-3 items-end">
          <div><Label htmlFor="os-from">С</Label><Input id="os-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="os-to">По</Label><Input id="os-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Select value={position} onValueChange={setPosition}>
            <SelectTrigger className="w-48" aria-label="Позиция"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все позиции</SelectItem>
              {positions.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {loading ? <p className="text-muted-foreground">Загрузка…</p> : (
          <div className="space-y-3">
            {shown.map((s) => (
              <Card key={s.shift_id}>
                <CardContent className="pt-6 flex items-start gap-3">
                  <Checkbox className="mt-1 h-6 w-6" checked={picked.includes(s.shift_id)} onCheckedChange={() => toggle(s.shift_id)} aria-label="Выбрать смену" disabled={s.overlaps} />
                  <div className="flex-1 space-y-1">
                    <div className="font-semibold">{dateLong(s.shift_date)}, {timeIn(s.start_at, s.timezone)}–{timeIn(s.end_at, s.timezone)}</div>
                    <div className="text-sm text-muted-foreground">{s.site_name} · {s.position_name}{s.address ? ` · ${s.address}` : ''}</div>
                    <div className="text-sm">Ставка {fmtMoney(s.worker_rate)}/ч · ориентировочно {fmtMoney(s.est_earnings)} за смену</div>
                    <div className="flex gap-2">
                      <Badge variant="secondary">мест: {s.free_places}</Badge>
                      {s.overlaps && <Badge variant="destructive">пересекается с вашей сменой</Badge>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {!shown.length && <p className="text-muted-foreground">Подходящих смен нет.</p>}
          </div>
        )}
        {picked.length > 0 && (
          <div className="sticky bottom-4">
            <Button className="w-full min-h-12" onClick={send} disabled={busy}>Откликнуться на смены: {picked.length}</Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default WorkerOpenShifts;
