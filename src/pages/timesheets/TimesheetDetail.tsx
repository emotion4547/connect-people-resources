import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/usePermissions';
import { db, rpc } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { LINE_STATUSES, TIMESHEET_STATUSES, fmtDateTime, hm, type Timesheet, type TimesheetLine } from '@/lib/timesheetsMeta';
import { AdjustmentDialog } from '@/components/timesheets/AdjustmentDialog';
import PageMeta from '@/components/PageMeta';
import { ArrowLeft, Printer, Send } from 'lucide-react';

interface Dispute {
  id: string; assignment_id: string; proposed_hours: number; original_hours: number | null; reason: string; status: string;
  resolution_comment: string | null;
}

const TimesheetDetail: React.FC = () => {
  const { id } = useParams();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [ts, setTs] = useState<Timesheet | null>(null);
  const [siteName, setSiteName] = useState('');
  const [lines, setLines] = useState<TimesheetLine[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [busy, setBusy] = useState(false);

  const [resolving, setResolving] = useState<Dispute | null>(null);
  const [comment, setComment] = useState('');

  const [overtimeFor, setOvertimeFor] = useState<TimesheetLine | null>(null);
  const [overtime, setOvertime] = useState('0');

  const [adjustFor, setAdjustFor] = useState<TimesheetLine | null>(null);
  const [ratingFor, setRatingFor] = useState<TimesheetLine | null>(null);
  const [rating, setRating] = useState('5');
  const [ratingComment, setRatingComment] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const t = await db('timesheets').select('*').eq('id', id).maybeSingle();
    if (t.error || !t.data) { toast({ title: 'Табель не найден', description: t.error?.message, variant: 'destructive' }); return; }
    setTs(t.data);
    const [s, l, d] = await Promise.all([
      db('sites').select('name').eq('id', t.data.site_id).maybeSingle(),
      rpc('timesheet_lines', { _timesheet_id: id }),
      db('timesheet_disputes').select('*').eq('timesheet_id', id).order('created_at'),
    ]);
    setSiteName(s.data?.name ?? '');
    if (l.error) toast({ title: 'Не удалось загрузить строки', description: l.error.message, variant: 'destructive' });
    setLines(l.data ?? []);
    setDisputes(d.data ?? []);
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn: string, args: Record<string, unknown>, okTitle?: string) => {
    setBusy(true);
    const { error } = await rpc(fn, args);
    setBusy(false);
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return false; }
    if (okTitle) toast({ title: okTitle });
    await load();
    return true;
  };

  const total = lines.reduce((s, l) => s + Number(l.approved_hours ?? 0), 0);
  const dispute = (l: TimesheetLine) => disputes.find((d) => d.id === l.dispute_id);
  const canUpdate = can('timesheets', 'update');

  if (!ts) return <AppLayout><p className="text-muted-foreground">Загрузка…</p></AppLayout>;

  return (
    <AppLayout>
      <PageMeta title="Табель" description="Строки табеля, споры и подтверждение" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <Link to="/timesheets" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline"><ArrowLeft className="w-4 h-4" /> Все табели</Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">{siteName}</h1>
            <p className="text-muted-foreground">
              {fmtDate(ts.period_from)} — {fmtDate(ts.period_to)} · часов всего: <span className="font-medium text-foreground">{total.toFixed(2)}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button asChild variant="outline" className="gap-2"><Link to={`/timesheets/${ts.id}/print`} target="_blank"><Printer className="w-4 h-4" /> Печатная форма</Link></Button>
            <Badge variant={ts.status === 'disputed' ? 'destructive' : 'secondary'}>{TIMESHEET_STATUSES[ts.status]}</Badge>
            {ts.confirmed_auto && <Badge variant="outline">подтверждён автоматически</Badge>}
            {ts.status === 'draft' && canUpdate && (
              <Button className="gap-2" disabled={busy} onClick={() => run('send_timesheet', { _timesheet_id: ts.id }, 'Табель отправлен заказчику')}>
                <Send className="w-4 h-4" /> Отправить заказчику
              </Button>
            )}
          </div>
        </div>
        {(ts.status === 'pending' || ts.status === 'disputed') && (
          <p className="text-sm text-muted-foreground">Заказчик отвечает до {fmtDateTime(ts.confirm_deadline)}, затем неоспоренные строки подтвердятся сами.</p>
        )}

        <Card>
          <CardHeader><CardTitle className="text-base">Строки</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Дата</TableHead><TableHead>Исполнитель</TableHead><TableHead>Приход</TableHead><TableHead>Уход</TableHead>
                  <TableHead>План</TableHead><TableHead>Часы</TableHead><TableHead>Статус</TableHead><TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((l) => {
                  const d = dispute(l);
                  return (
                    <TableRow key={l.assignment_id}>
                      <TableCell>{fmtDate(l.shift_date)}</TableCell>
                      <TableCell>
                        {l.worker_name}
                        <div className="text-xs text-muted-foreground">{l.position_name}</div>
                      </TableCell>
                      <TableCell>
                        {hm(l.check_in_at)}
                        {l.manual_in && <Badge variant="outline" className="ml-1">вручную</Badge>}
                        {l.late_minutes > 0 && <div className="text-xs text-muted-foreground">опоздание {l.late_minutes} мин</div>}
                      </TableCell>
                      <TableCell>
                        {hm(l.check_out_at)}
                        {l.manual_out && <Badge variant="outline" className="ml-1">вручную</Badge>}
                        {l.auto_out && <Badge variant="outline" className="ml-1">авто</Badge>}
                      </TableCell>
                      <TableCell>{l.planned_hours ?? '—'}</TableCell>
                      <TableCell>
                        <span className="font-medium">{l.approved_hours ?? '—'}</span>
                        {l.overtime_hours > 0 && (
                          <div className="text-xs text-muted-foreground">переработка {l.overtime_hours}, утверждено {l.overtime_approved_hours}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={l.line_status === 'disputed' ? 'destructive' : 'secondary'}>{l.line_status ? LINE_STATUSES[l.line_status] : '—'}</Badge>
                        {d && d.status === 'open' && (
                          <div className="text-xs mt-1">Заказчик предлагает {d.proposed_hours} ч: {d.reason}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right space-x-2 whitespace-nowrap">
                        {canUpdate && d?.status === 'open' && <Button size="sm" onClick={() => { setResolving(d); setComment(''); }}>Решить спор</Button>}
                        {canUpdate && l.overtime_hours > 0 && l.line_status !== 'confirmed' && (
                          <Button size="sm" variant="outline" onClick={() => { setOvertimeFor(l); setOvertime(String(l.overtime_approved_hours)); }}>Переработка</Button>
                        )}
                        {l.line_status === 'confirmed' && (can('accruals', 'create') || canUpdate) && (
                          <Button size="sm" variant="outline" onClick={() => setAdjustFor(l)}>Бонус / удержание</Button>
                        )}
                        {canUpdate && <Button size="sm" variant="ghost" onClick={() => { setRatingFor(l); setRating('5'); setRatingComment(''); }}>Оценить</Button>}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!lines.length && <TableRow><TableCell colSpan={8} className="text-muted-foreground">Строк нет.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <AdjustmentDialog assignmentId={adjustFor?.assignment_id ?? null} workerName={adjustFor?.worker_name} onClose={() => setAdjustFor(null)} onDone={load} />

      <Dialog open={!!resolving} onOpenChange={(o) => !o && setResolving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Спор по строке</DialogTitle>
            <DialogDescription>
              {resolving && `Заказчик предлагает ${resolving.proposed_hours} ч вместо ${resolving.original_hours ?? '—'}: ${resolving.reason}`}
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="comment">Комментарий (при отказе обязателен)</Label>
          <Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" disabled={busy || !comment.trim()}
              onClick={async () => { if (resolving && await run('resolve_dispute', { _dispute_id: resolving.id, _accept: false, _comment: comment }, 'Отказ отправлен заказчику')) setResolving(null); }}>
              Отклонить
            </Button>
            <Button disabled={busy}
              onClick={async () => { if (resolving && await run('resolve_dispute', { _dispute_id: resolving.id, _accept: true, _comment: comment || null }, 'Правка принята')) setResolving(null); }}>
              Принять правку
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!overtimeFor} onOpenChange={(o) => !o && setOvertimeFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Утвердить переработку</DialogTitle>
            <DialogDescription>{overtimeFor && `Фактически сверх плана: ${overtimeFor.overtime_hours} ч. В часы войдёт только утверждённая часть.`}</DialogDescription>
          </DialogHeader>
          <Label htmlFor="ot">Утвердить часов</Label>
          <Input id="ot" type="number" step="0.25" min="0" value={overtime} onChange={(e) => setOvertime(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOvertimeFor(null)}>Отмена</Button>
            <Button disabled={busy}
              onClick={async () => { if (overtimeFor && await run('approve_overtime', { _assignment_id: overtimeFor.assignment_id, _hours: Number(overtime) }, 'Переработка утверждена')) setOvertimeFor(null); }}>
              Утвердить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!ratingFor} onOpenChange={(o) => !o && setRatingFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Оценка исполнителя</DialogTitle>
            <DialogDescription>{ratingFor?.worker_name}. Оценка менеджера входит в рейтинг за 90 дней.</DialogDescription>
          </DialogHeader>
          <Select value={rating} onValueChange={setRating}>
            <SelectTrigger aria-label="Оценка"><SelectValue /></SelectTrigger>
            <SelectContent>{[5, 4, 3, 2, 1].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea value={ratingComment} onChange={(e) => setRatingComment(e.target.value)} placeholder="Комментарий (необязательно)" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRatingFor(null)}>Отмена</Button>
            <Button disabled={busy}
              onClick={async () => { if (ratingFor && await run('rate_assignment', { _assignment_id: ratingFor.assignment_id, _rating: Number(rating), _comment: ratingComment || null }, 'Оценка сохранена')) setRatingFor(null); }}>
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default TimesheetDetail;
