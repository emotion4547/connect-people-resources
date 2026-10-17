import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db, rpc } from '@/lib/db';
import { downloadExcel } from '@/lib/csv';
import { fmtDate, fmtMoney } from '@/lib/format';
import { LINE_STATUSES, TIMESHEET_STATUSES, fmtDateTime, hm, type Timesheet, type TimesheetLine } from '@/lib/timesheetsMeta';
import PageMeta from '@/components/PageMeta';
import { ArrowLeft, Download } from 'lucide-react';


// К-4: табель глазами заказчика — подтвердить, оспорить строку, поставить оценку, выгрузить. Ставок и сумм исполнителя здесь нет.
const ClientTimesheetDetail: React.FC = () => {
  const { id } = useParams();
  const { toast } = useToast();
  const [ts, setTs] = useState<Timesheet | null>(null);
  const [siteName, setSiteName] = useState('');
  const [lines, setLines] = useState<TimesheetLine[]>([]);
  const [summary, setSummary] = useState<{ hours: number; amount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [disputeFor, setDisputeFor] = useState<TimesheetLine | null>(null);
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [rateFor, setRateFor] = useState<TimesheetLine | null>(null);
  const [rating, setRating] = useState('5');
  const [rateComment, setRateComment] = useState('');
  const [block, setBlock] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const t = await db('timesheets').select('*').eq('id', id).maybeSingle();
    if (t.error || !t.data) { toast({ title: 'Табель не найден', description: t.error?.message, variant: 'destructive' }); return; }
    setTs(t.data);
    const [s, l, m] = await Promise.all([
      db('sites').select('name').eq('id', t.data.site_id).maybeSingle(),
      rpc('timesheet_lines', { _timesheet_id: id }),
      rpc('client_timesheet_summary', { _timesheet_id: id }),
    ]);
    setSiteName(s.data?.name ?? '');
    setLines(l.data ?? []);
    setSummary(m.error ? null : m.data?.[0] ?? null);
    if (m.error) toast({ title: 'Не удалось загрузить итог табеля', description: m.error.message, variant: 'destructive' });
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await rpc(fn, args);
    setBusy(false);
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return false; }
    toast({ title: ok });
    await load();
    return true;
  };

  if (!ts) return <DashboardLayout role="hr"><p className="text-muted-foreground">Загрузка…</p></DashboardLayout>;

  const open = ts.status === 'pending' || ts.status === 'disputed';
  const hasPending = lines.some((l) => l.line_status === 'pending');

  const exportCsv = () => downloadExcel(`tabel-${siteName}-${ts.period_from}-${ts.period_to}.xlsx`,
    ['Дата', 'Исполнитель', 'Приход', 'Уход', 'Часы', 'Статус'],
    lines.map((l) => [fmtDate(l.shift_date), l.worker_name, hm(l.check_in_at), hm(l.check_out_at), Number(l.approved_hours ?? 0), l.line_status ? LINE_STATUSES[l.line_status] : '']));

  return (
    <DashboardLayout role="hr">
      <PageMeta title="Табель" description="Подтверждение табеля" />
      <div className="max-w-4xl mx-auto space-y-4 animate-slide-up">
        <Link to="/client/timesheets" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline"><ArrowLeft className="w-4 h-4" /> Все табели</Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{siteName}</h1>
            <p className="text-muted-foreground">{fmtDate(ts.period_from)} — {fmtDate(ts.period_to)} · часов {summary ? Number(summary.hours).toFixed(2) : '—'} · к оплате {summary ? fmtMoney(summary.amount) : '—'}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={ts.status === 'disputed' ? 'destructive' : 'secondary'}>{TIMESHEET_STATUSES[ts.status]}</Badge>
            <Button variant="outline" size="sm" className="gap-2" onClick={exportCsv}><Download className="w-4 h-4" /> В Excel</Button>
          </div>
        </div>
        {open && (
          <Card className="border-primary">
            <CardContent className="pt-6 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">Если не ответить до {fmtDateTime(ts.confirm_deadline)}, строки без споров подтвердятся сами.</p>
              <Button className="min-h-11" disabled={busy || !hasPending} onClick={() => run('confirm_timesheet', { _timesheet_id: ts.id }, 'Табель подтверждён')}>Подтвердить всё без споров</Button>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle className="text-base">Строки</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Дата</TableHead><TableHead>Исполнитель</TableHead><TableHead>Приход</TableHead><TableHead>Уход</TableHead><TableHead>Часы</TableHead><TableHead>Статус</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.assignment_id}>
                    <TableCell>{fmtDate(l.shift_date)}</TableCell>
                    <TableCell>{l.worker_name}<div className="text-xs text-muted-foreground">{l.position_name}</div></TableCell>
                    <TableCell>{hm(l.check_in_at)}{l.late_minutes > 0 && <div className="text-xs text-muted-foreground">опоздание {l.late_minutes} мин</div>}</TableCell>
                    <TableCell>{hm(l.check_out_at)}</TableCell>
                    <TableCell className="font-medium">{l.approved_hours ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant={l.line_status === 'disputed' ? 'destructive' : 'secondary'}>{l.line_status ? LINE_STATUSES[l.line_status] : '—'}</Badge>
                      {l.line_status === 'disputed' && l.dispute_proposed !== null && <div className="text-xs">Вы предложили {l.dispute_proposed} ч</div>}
                    </TableCell>
                    <TableCell className="text-right space-x-2 whitespace-nowrap">
                      {open && l.line_status === 'pending' && <Button size="sm" variant="outline" onClick={() => { setDisputeFor(l); setHours(String(l.approved_hours ?? '')); setReason(''); }}>Оспорить</Button>}
                      <Button size="sm" variant="ghost" onClick={() => { setRateFor(l); setRating('5'); setRateComment(''); setBlock(false); }}>Оценить</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!disputeFor} onOpenChange={(o) => !o && setDisputeFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Оспорить строку</DialogTitle>
            <DialogDescription>{disputeFor?.worker_name}, {disputeFor && fmtDate(disputeFor.shift_date)}. Менеджер ответит; остальные строки можно подтвердить сразу.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="d-h">Сколько часов, по-вашему</Label>
          <Input id="d-h" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
          <Label htmlFor="d-r">Причина</Label>
          <Textarea id="d-r" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeFor(null)}>Отмена</Button>
            <Button disabled={busy || !reason.trim() || hours === ''}
              onClick={async () => { if (disputeFor && await run('dispute_line', { _timesheet_id: ts.id, _assignment_id: disputeFor.assignment_id, _proposed_hours: Number(hours.replace(',', '.')), _reason: reason }, 'Спор отправлен менеджеру')) setDisputeFor(null); }}>
              Отправить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!rateFor} onOpenChange={(o) => !o && setRateFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Оценка исполнителя</DialogTitle><DialogDescription>{rateFor?.worker_name}</DialogDescription></DialogHeader>
          <Select value={rating} onValueChange={setRating}>
            <SelectTrigger aria-label="Оценка"><SelectValue /></SelectTrigger>
            <SelectContent>{[5, 4, 3, 2, 1].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea value={rateComment} onChange={(e) => setRateComment(e.target.value)} placeholder="Комментарий (необязательно)" />
          {rating === '1' && (
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={block} onCheckedChange={(v) => setBlock(v === true)} /> Больше не присылать этого человека на объект</label>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRateFor(null)}>Отмена</Button>
            <Button disabled={busy}
              onClick={async () => { if (rateFor && await run('rate_assignment', { _assignment_id: rateFor.assignment_id, _rating: Number(rating), _comment: rateComment || null, _blocklist: block }, 'Оценка сохранена')) setRateFor(null); }}>
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default ClientTimesheetDetail;
