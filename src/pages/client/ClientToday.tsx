import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db, rpc } from '@/lib/db';
import { addDays, today } from '@/lib/format';
import { dateLong, timeIn, type ClientShift } from '@/lib/cabinetMeta';
import { ASSIGNMENT_STATUSES } from '@/lib/planningMeta';
import PageMeta from '@/components/PageMeta';

interface Person { assignment_id: string; worker_name: string; rating: number | null; status: string; check_in_at: string | null; late_minutes: number }

// К-1: «Сегодня» — по каждому объекту нужно / подтвердили / на месте. Обновляется сама раз в полминуты.
const ClientToday: React.FC = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<ClientShift[]>([]);
  const [pending, setPending] = useState(0);
  const [people, setPeople] = useState<{ shift: ClientShift; list: Person[] } | null>(null);

  const load = useCallback(async () => {
    const [s, t] = await Promise.all([
      rpc('client_shifts', { _from: today(), _to: addDays(today(), 1) }),
      db('timesheets').select('id').in('status', ['pending', 'disputed']),
    ]);
    if (s.error) { toast({ title: 'Не удалось загрузить смены', description: s.error.message, variant: 'destructive' }); return; }
    setRows(s.data ?? []);
    setPending((t.data ?? []).length);
  }, [toast]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const open = async (shift: ClientShift) => {
    const { data, error } = await rpc('client_shift_people', { _shift_id: shift.shift_id });
    if (error) { toast({ title: 'Не удалось загрузить людей', description: error.message, variant: 'destructive' }); return; }
    setPeople({ shift, list: data ?? [] });
  };

  const group = (date: string) => rows.filter((r) => r.shift_date === date && r.status !== 'cancelled');
  const day = (title: string, date: string) => (
    <section className="space-y-3">
      <h2 className="font-semibold">{title} · {dateLong(date)}</h2>
      {group(date).map((s) => (
        <Card key={s.shift_id}>
          <CardContent className="pt-6 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-medium">{s.site_name} · {s.position_name}</div>
                <div className="text-sm text-muted-foreground">{timeIn(s.start_at, s.timezone)}–{timeIn(s.end_at, s.timezone)}</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => open(s)}>Кто выходит</Button>
            </div>
            <div className="grid grid-cols-3 text-center gap-2">
              <div><div className="text-2xl font-bold">{s.headcount}</div><div className="text-xs text-muted-foreground">нужно</div></div>
              <div><div className="text-2xl font-bold">{s.confirmed_count}</div><div className="text-xs text-muted-foreground">подтвердили</div></div>
              <div><div className="text-2xl font-bold">{s.on_site_count}</div><div className="text-xs text-muted-foreground">на месте</div></div>
            </div>
            {s.assigned_count < s.headcount && <Badge variant="destructive">не хватает: {s.headcount - s.assigned_count}</Badge>}
          </CardContent>
        </Card>
      ))}
      {!group(date).length && <p className="text-sm text-muted-foreground">Смен нет.</p>}
    </section>
  );

  return (
    <DashboardLayout role="hr">
      <PageMeta title="Сегодня" description="Смены на сегодня и завтра" />
      <div className="max-w-3xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Сегодня</h1>
          <Button asChild><Link to="/client/order">Новый заказ</Link></Button>
        </div>
        {pending > 0 && (
          <Card className="border-primary">
            <CardHeader><CardTitle className="text-base">Табели ждут вашего ответа: {pending}</CardTitle></CardHeader>
            <CardContent><Button asChild variant="outline"><Link to="/client/timesheets">Открыть табели</Link></Button></CardContent>
          </Card>
        )}
        {day('Сегодня', today())}
        {day('Завтра', addDays(today(), 1))}
      </div>

      <Dialog open={!!people} onOpenChange={(o) => !o && setPeople(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Кто выходит</DialogTitle>
            <DialogDescription>{people && `${people.shift.site_name}, ${timeIn(people.shift.start_at, people.shift.timezone)}`}</DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader><TableRow><TableHead>Исполнитель</TableHead><TableHead>Рейтинг</TableHead><TableHead>Статус</TableHead></TableRow></TableHeader>
            <TableBody>
              {people?.list.map((p) => (
                <TableRow key={p.assignment_id}>
                  <TableCell>{p.worker_name}</TableCell>
                  <TableCell>{p.rating ?? '—'}</TableCell>
                  <TableCell>
                    {ASSIGNMENT_STATUSES[p.status] ?? p.status}
                    {p.check_in_at && <div className="text-xs text-muted-foreground">пришёл в {timeIn(p.check_in_at, people.shift.timezone)}{p.late_minutes > 0 ? `, опоздание ${p.late_minutes} мин` : ''}</div>}
                  </TableCell>
                </TableRow>
              ))}
              {!people?.list.length && <TableRow><TableCell colSpan={3} className="text-muted-foreground">Пока никого не назначили.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default ClientToday;
