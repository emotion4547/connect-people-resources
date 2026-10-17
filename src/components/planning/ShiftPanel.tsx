import React, { useCallback, useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db, rpc } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { fmtTime } from '@/lib/ordersMeta';
import { ACTIVE_ASSIGNMENT, ASSIGNMENT_STATUSES, type StaffingRow } from '@/lib/planningMeta';

interface Props {
  shift: StaffingRow | null; tz: string; title: string; canManage: boolean; onClose: () => void; onChanged: () => void;
}
interface AssignmentRow {
  id: string; worker_id: string; status: string; is_reserve: boolean; late_cancel: boolean; source: string; full_name?: string;
}
interface Candidate {
  worker_id: string; full_name: string; phone: string | null; status: string; rating: number | null; free: boolean;
  no_shows_90d: number; worked_here: number; can_assign: boolean; problems: string | null;
}
interface ReportRow { worker_id: string; result: string; reason: string | null; shift_id: string }
interface Option { id: string; name: string }

const RESULT_LABELS: Record<string, string> = { assigned: 'назначен', reserve: 'в резерве', rejected: 'отклонён' };

export const ShiftPanel: React.FC<Props> = ({ shift, tz, title, canManage, onClose, onChanged }) => {
  const { toast } = useToast();
  const [rows, setRows] = useState<AssignmentRow[]>([]);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [wholeOrder, setWholeOrder] = useState(false);
  const [report, setReport] = useState<ReportRow[] | null>(null);
  const [cancelReasons, setCancelReasons] = useState<Option[]>([]);
  const [noShowReasons, setNoShowReasons] = useState<Option[]>([]);
  const [reasonId, setReasonId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!shift) return;
    const { data, error } = await db('assignments').select('id,worker_id,status,is_reserve,late_cancel,source').eq('shift_id', shift.shift_id).order('created_at');
    if (error) { toast({ title: 'Не удалось загрузить назначения', description: error.message, variant: 'destructive' }); return; }
    const list: AssignmentRow[] = data ?? [];
    if (list.length) {
      const w = await db('workers').select('user_id,full_name').in('user_id', list.map((x) => x.worker_id));
      const names = new Map<string, string>((w.data ?? []).map((x: { user_id: string; full_name: string }) => [x.user_id, x.full_name]));
      list.forEach((x) => { x.full_name = names.get(x.worker_id) ?? x.worker_id; });
    }
    setRows(list);
    const [c, n] = await Promise.all([
      db('directories').select('id,name').eq('org_id', shift.org_id).eq('kind', 'cancel_reason').eq('is_active', true).order('sort_order'),
      db('directories').select('id,name').eq('org_id', shift.org_id).eq('kind', 'no_show_reason').eq('is_active', true).order('sort_order'),
    ]);
    setCancelReasons(c.data ?? []); setNoShowReasons(n.data ?? []);
  }, [shift, toast]);

  const search = useCallback(async () => {
    if (!shift || !canManage) return;
    const { data, error } = await rpc('find_workers', { _shift_id: shift.shift_id, _query: query || null, _limit: 50 });
    if (error) { toast({ title: 'Не удалось выполнить поиск', description: error.message, variant: 'destructive' }); return; }
    setCandidates(data ?? []);
  }, [shift, canManage, query, toast]);

  useEffect(() => { setReport(null); setChosen(new Set()); setCandidates([]); setQuery(''); setReasonId(''); load(); }, [shift, load]);
  useEffect(() => { const t = setTimeout(search, 300); return () => clearTimeout(t); }, [search]);

  const refresh = () => { load(); search(); onChanged(); };

  const act = async (fn: string, args: Record<string, unknown>, okText: string) => {
    setBusy(true);
    const { error } = await rpc(fn, args);
    setBusy(false);
    if (error) { toast({ title: 'Не удалось выполнить', description: error.message, variant: 'destructive' }); return; }
    toast({ title: okText });
    refresh();
  };

  const assign = async () => {
    if (!shift || chosen.size === 0) return;
    setBusy(true);
    let shiftIds = [shift.shift_id];
    if (wholeOrder) {
      const { data } = await db('shifts').select('id').eq('order_id', shift.order_id).gte('start_at', shift.start_at).neq('status', 'cancelled');
      shiftIds = (data ?? []).map((x: { id: string }) => x.id);
    }
    const { data, error } = await rpc('assign_workers', { _shift_ids: shiftIds, _worker_ids: Array.from(chosen) });
    setBusy(false);
    if (error) { toast({ title: 'Не удалось назначить', description: error.message, variant: 'destructive' }); return; }
    setReport(data ?? []);
    setChosen(new Set());
    refresh();
  };

  const blockWorker = async (workerId: string, scope: 'site' | 'client') => {
    if (!shift) return;
    const reason = window.prompt('Причина стоп-листа');
    if (!reason?.trim()) return;
    const { error } = await db('worker_blocks').insert({
      org_id: shift.org_id, worker_id: workerId, reason: reason.trim(),
      ...(scope === 'site' ? { site_id: shift.site_id } : { client_id: shift.client_id }),
    });
    if (error) toast({ title: 'Не удалось добавить в стоп-лист', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Добавлен в стоп-лист' }); refresh(); }
  };

  const nameOf = (id: string) => rows.find((r) => r.worker_id === id)?.full_name ?? candidates.find((c) => c.worker_id === id)?.full_name ?? id;
  const started = shift ? new Date(shift.start_at).getTime() <= Date.now() : false;
  const active = rows.filter((r) => ACTIVE_ASSIGNMENT.includes(r.status));
  const responses = rows.filter((r) => r.status === 'responded');
  const history = rows.filter((r) => !ACTIVE_ASSIGNMENT.includes(r.status) && r.status !== 'responded');

  return (
    <Sheet open={!!shift} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
        {shift && (
          <>
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>
                {fmtDate(shift.shift_date)}, {fmtTime(shift.start_at, tz)}–{fmtTime(shift.end_at, tz)}. Нужно {shift.headcount}
                {shift.reserve_count > 0 && ` + резерв ${shift.reserve_count}`}; назначено {shift.assigned_count}, подтвердили {shift.confirmed_count}.
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 mt-6">
              <section className="space-y-2">
                <h3 className="font-semibold">Состав</h3>
                {canManage && (
                  <Select value={reasonId} onValueChange={setReasonId}>
                    <SelectTrigger className="w-72" aria-label="Причина"><SelectValue placeholder="Причина (для отмены или неявки)" /></SelectTrigger>
                    <SelectContent>
                      {[...cancelReasons.map((r) => ({ ...r, group: 'отмена' })), ...noShowReasons.map((r) => ({ ...r, group: 'неявка' }))].map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name} ({r.group})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Table>
                  <TableHeader><TableRow><TableHead>Исполнитель</TableHead><TableHead>Статус</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {active.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.full_name}{r.is_reserve && <Badge variant="outline" className="ml-2">резерв</Badge>}</TableCell>
                        <TableCell><Badge variant="secondary">{ASSIGNMENT_STATUSES[r.status]}</Badge></TableCell>
                        <TableCell className="text-right space-x-1 whitespace-nowrap">
                          {canManage && r.is_reserve && <Button size="sm" variant="outline" disabled={busy} onClick={() => act('promote_reserve', { _assignment_id: r.id }, 'Переведён в основной состав')}>В основной</Button>}
                          {canManage && !started && <Button size="sm" variant="ghost" disabled={busy || !cancelReasons.some((c) => c.id === reasonId)} onClick={() => act('cancel_assignment', { _assignment_id: r.id, _reason_id: reasonId, _on_behalf_of_worker: false }, 'Исполнитель снят')}>Снять</Button>}
                          {canManage && started && r.status !== 'worked' && <Button size="sm" variant="ghost" disabled={busy || !noShowReasons.some((c) => c.id === reasonId)} onClick={() => act('mark_no_show', { _assignment_id: r.id, _reason_id: reasonId }, 'Неявка отмечена')}>Не вышел</Button>}
                          {canManage && <Button size="sm" variant="ghost" onClick={() => blockWorker(r.worker_id, 'site')}>В стоп-лист</Button>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!active.length && <TableRow><TableCell colSpan={3} className="text-muted-foreground">Никто не назначен.</TableCell></TableRow>}
                  </TableBody>
                </Table>
                {history.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Выбыли: {history.map((h) => `${h.full_name} — ${ASSIGNMENT_STATUSES[h.status].toLowerCase()}${h.late_cancel ? ' (поздно)' : ''}`).join('; ')}
                  </p>
                )}
              </section>

              {responses.length > 0 && (
                <section className="space-y-2">
                  <h3 className="font-semibold">Отклики ({responses.length})</h3>
                  {responses.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-sm">
                      <span>{r.full_name}</span>
                      {canManage && (
                        <span className="space-x-2">
                          <Button size="sm" disabled={busy} onClick={async () => {
                            setBusy(true);
                            const { data, error } = await rpc('review_responses', { _assignment_ids: [r.id], _accept: true });
                            setBusy(false);
                            if (error) toast({ title: 'Не удалось принять', description: error.message, variant: 'destructive' });
                            else if (data?.[0]?.result === 'blocked') toast({ title: 'Принять нельзя', description: data[0].reason, variant: 'destructive' });
                            else toast({ title: 'Отклик принят' });
                            refresh();
                          }}>Принять</Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => act('review_responses', { _assignment_ids: [r.id], _accept: false }, 'Отклик отклонён')}>Отклонить</Button>
                        </span>
                      )}
                    </div>
                  ))}
                </section>
              )}

              {canManage && (
                <section className="space-y-3">
                  <h3 className="font-semibold">Назначить</h3>
                  <Input placeholder="ФИО или телефон" aria-label="Поиск исполнителя" value={query} onChange={(e) => setQuery(e.target.value)} />
                  <div className="max-h-72 overflow-y-auto border rounded-md">
                    <Table>
                      <TableHeader><TableRow><TableHead className="w-8" /><TableHead>Исполнитель</TableHead><TableHead>Свободен</TableHead><TableHead>Рейтинг</TableHead><TableHead>Неявки 90 дн.</TableHead><TableHead>Был здесь</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {candidates.map((c) => (
                          <TableRow key={c.worker_id} className={c.can_assign ? '' : 'opacity-60'}>
                            <TableCell>
                              <Checkbox checked={chosen.has(c.worker_id)} disabled={!c.can_assign}
                                onCheckedChange={(on) => setChosen((prev) => { const n = new Set(prev); if (on) n.add(c.worker_id); else n.delete(c.worker_id); return n; })}
                                aria-label={`Выбрать ${c.full_name}`} />
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{c.full_name}</div>
                              {!c.can_assign && c.problems && <div className="text-xs text-destructive">{c.problems}</div>}
                            </TableCell>
                            <TableCell>{c.free ? 'да' : 'нет'}</TableCell>
                            <TableCell>{c.rating ?? '—'}</TableCell>
                            <TableCell>{c.no_shows_90d}</TableCell>
                            <TableCell>{c.worked_here}</TableCell>
                          </TableRow>
                        ))}
                        {!candidates.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Исполнители не найдены.</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={wholeOrder} onCheckedChange={(on) => setWholeOrder(on === true)} />
                    На все смены этого заказа, начиная с этой
                  </label>
                  <Button onClick={assign} disabled={busy || chosen.size === 0}>Назначить выбранных ({chosen.size})</Button>

                  {report && (
                    <div className="border rounded-md p-3 text-sm space-y-1">
                      <p className="font-medium">Результат</p>
                      {report.map((x, i) => (
                        <p key={i} className={x.result === 'rejected' ? 'text-destructive' : ''}>
                          {nameOf(x.worker_id)}: {RESULT_LABELS[x.result] ?? x.result}{x.reason ? ` — ${x.reason}` : ''}
                        </p>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
