import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { useNavigate } from 'react-router-dom';
import { useOrg } from '@/contexts/OrgContext';
import { usePermissions } from '@/hooks/usePermissions';
import { db, rpc } from '@/lib/db';
import { addDays, fmtDate, today } from '@/lib/format';
import { TIMESHEET_STATUSES, fmtDateTime, type Timesheet } from '@/lib/timesheetsMeta';
import PageMeta from '@/components/PageMeta';
import { downloadExcel } from '@/lib/csv';
import { Download, Plus } from 'lucide-react';

interface Option { id: string; name: string }
interface Alert { assignment_id: string; worker_id: string; site_id: string; start_at: string; minutes_late: number }

const ALL = 'all';

const TimesheetsList: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { orgId } = useOrg();
  const { can, loading: permsLoading } = usePermissions();
  const [rows, setRows] = useState<Timesheet[]>([]);
  const [sites, setSites] = useState<Option[]>([]);
  const [workers, setWorkers] = useState<Option[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [status, setStatus] = useState(ALL);
  const [loading, setLoading] = useState(true);

  const [building, setBuilding] = useState(false);
  const [siteId, setSiteId] = useState('');
  const [from, setFrom] = useState(addDays(today(), -6));
  const [to, setTo] = useState(today());
  const [saving, setSaving] = useState(false);

  const [markFor, setMarkFor] = useState<Alert | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    let q = db('timesheets').select('*').eq('org_id', orgId).order('period_from', { ascending: false }).limit(200);
    if (status !== ALL) q = q.eq('status', status);
    const [t, s, a, w] = await Promise.all([
      q,
      db('sites').select('id,name').eq('org_id', orgId),
      db('attendance_alerts').select('assignment_id,worker_id,site_id,start_at,minutes_late').eq('org_id', orgId),
      db('workers').select('user_id,full_name').eq('org_id', orgId),
    ]);
    setLoading(false);
    if (t.error) { toast({ title: 'Не удалось загрузить табели', description: t.error.message, variant: 'destructive' }); return; }
    setRows(t.data ?? []);
    setSites(s.data ?? []);
    setAlerts(a.data ?? []);
    setWorkers((w.data ?? []).map((x: { user_id: string; full_name: string }) => ({ id: x.user_id, name: x.full_name })));
  }, [orgId, status, toast]);

  useEffect(() => { load(); }, [load]);

  const name = (list: Option[], id: string) => list.find((x) => x.id === id)?.name ?? '—';

  const exportCsv = () => downloadExcel('tabeli.xlsx', ['Объект', 'С', 'По', 'Статус'],
    rows.map((t) => [name(sites, t.site_id), fmtDate(t.period_from), fmtDate(t.period_to), TIMESHEET_STATUSES[t.status]]));

  const build = async () => {
    setSaving(true);
    const { data, error } = await rpc('build_timesheet', { _site_id: siteId, _from: from, _to: to });
    setSaving(false);
    if (error) { toast({ title: 'Табель не собран', description: error.message, variant: 'destructive' }); return; }
    setBuilding(false);
    navigate(`/timesheets/${data}`);
  };

  const markIn = async () => {
    if (!markFor) return;
    setSaving(true);
    const { error } = await rpc('manual_check', { _assignment_id: markFor.assignment_id, _kind: 'in', _at: new Date().toISOString(), _reason: reason });
    setSaving(false);
    if (error) { toast({ title: 'Отметка не поставлена', description: error.message, variant: 'destructive' }); return; }
    setMarkFor(null); setReason('');
    load();
  };

  return (
    <AppLayout>
      <PageMeta title="Табель" description="Табели по объектам, отметки и споры" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Табель</h1>
            <p className="text-muted-foreground">Часы исполнителей по объектам. Подтверждённый заказчиком табель — основа для актов и выплат.</p>
          </div>
          {can('timesheets', 'create') && <Button onClick={() => setBuilding(true)} className="gap-2"><Plus className="w-4 h-4" /> Собрать табель</Button>}
        </div>

        {alerts.length > 0 && (
          <Card className="border-destructive/40">
            <CardHeader><CardTitle className="text-base">Нет отметки о приходе ({alerts.length})</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Исполнитель</TableHead><TableHead>Объект</TableHead><TableHead>Начало</TableHead><TableHead>Опаздывает</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {alerts.map((a) => (
                    <TableRow key={a.assignment_id}>
                      <TableCell>{name(workers, a.worker_id)}</TableCell>
                      <TableCell>{name(sites, a.site_id)}</TableCell>
                      <TableCell>{fmtDateTime(a.start_at)}</TableCell>
                      <TableCell>{a.minutes_late} мин</TableCell>
                      <TableCell className="text-right">
                        {can('assignments', 'update') && <Button size="sm" variant="outline" onClick={() => setMarkFor(a)}>Отметить приход</Button>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-6 space-y-4">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-52" aria-label="Статус"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все статусы</SelectItem>
                {Object.entries(TIMESHEET_STATUSES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" className="gap-2 ml-3" onClick={exportCsv} disabled={!rows.length}><Download className="w-4 h-4" /> В Excel</Button>
            {permsLoading || loading ? <p className="text-muted-foreground">Загрузка…</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Объект</TableHead><TableHead>Период</TableHead><TableHead>Статус</TableHead><TableHead>Ответить до</TableHead></TableRow></TableHeader>
                <TableBody>
                  {rows.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell><Link to={`/timesheets/${t.id}`} className="font-medium hover:underline">{name(sites, t.site_id)}</Link></TableCell>
                      <TableCell>{fmtDate(t.period_from)} — {fmtDate(t.period_to)}</TableCell>
                      <TableCell className="space-x-2">
                        <Badge variant={t.status === 'disputed' ? 'destructive' : t.status === 'confirmed' ? 'default' : 'secondary'}>{TIMESHEET_STATUSES[t.status]}</Badge>
                        {t.confirmed_auto && <Badge variant="outline">авто</Badge>}
                      </TableCell>
                      <TableCell>{t.status === 'pending' || t.status === 'disputed' ? fmtDateTime(t.confirm_deadline) : '—'}</TableCell>
                    </TableRow>
                  ))}
                  {!rows.length && <TableRow><TableCell colSpan={4} className="text-muted-foreground">Табелей нет.</TableCell></TableRow>}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={building} onOpenChange={setBuilding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Собрать табель</DialogTitle>
            <DialogDescription>В табель войдут отработанные смены объекта за период, которых ещё нет в других табелях.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Объект</Label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger><SelectValue placeholder="Выберите объект" /></SelectTrigger>
                <SelectContent>{sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>С</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label>По</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuilding(false)}>Отмена</Button>
            <Button onClick={build} disabled={saving || !siteId || !from || !to}>Собрать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!markFor} onOpenChange={(o) => !o && setMarkFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отметить приход вручную</DialogTitle>
            <DialogDescription>{markFor && name(workers, markFor.worker_id)}. Причина попадёт в табель и журнал.</DialogDescription>
          </DialogHeader>
          <Label htmlFor="reason">Причина</Label>
          <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Например: сел телефон, нет связи" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkFor(null)}>Отмена</Button>
            <Button onClick={markIn} disabled={saving || !reason.trim()}>Отметить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default TimesheetsList;
