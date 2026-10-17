import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { usePermissions } from '@/hooks/usePermissions';
import { db, rpc } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { WORKER_STATUSES } from '@/lib/hiringMeta';
import PageMeta from '@/components/PageMeta';
import { downloadExcel } from '@/lib/csv';
import { Download, Search } from 'lucide-react';

interface WorkerRow { user_id: string; full_name: string; phone: string | null; city: string | null; status: string; tax_status: string | null; citizenship: string | null; rating: number | null; admitted_at: string | null }
interface ActivationRow { worker_id: string; full_name: string; phone: string | null; admitted_at: string | null; last_shift_at: string | null }
interface ReferralRow { referrer_name: string; referred_id: string; referred_name: string; shifts_worked: number; qualifies: boolean }
const TAX: Record<string, string> = { ip: 'ИП', self_employed: 'Самозанятый', gph: 'ГПХ', employment: 'Трудовой' };
const PAGE = 25;
const ALL = 'all';

const WorkersList: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const { can, loading: permsLoading } = usePermissions();
  const [rows, setRows] = useState<WorkerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(ALL);
  const [tax, setTax] = useState(ALL);
  const [citizenship, setCitizenship] = useState(ALL);
  const [activation, setActivation] = useState<{ kind: string; rows: ActivationRow[] }>({ kind: 'no_shift_14', rows: [] });
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);

  const load = useCallback(async () => {
    if (!orgId) return;
    let q = db('workers').select('user_id,full_name,phone,city,status,tax_status,citizenship,rating,admitted_at', { count: 'exact' })
      .eq('org_id', orgId).order('full_name').range(page * PAGE, page * PAGE + PAGE - 1);
    if (status !== ALL) q = q.eq('status', status);
    if (tax !== ALL) q = q.eq('tax_status', tax);
    if (citizenship === 'foreign') q = q.not('citizenship', 'in', '(Россия,РФ,Российская Федерация)').not('citizenship', 'is', null);
    if (citizenship === 'ru') q = q.in('citizenship', ['Россия', 'РФ', 'Российская Федерация']);
    const term = search.trim().replace(/[%,()]/g, ' ');
    if (term) q = q.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`);
    const { data, count, error } = await q;
    if (error) { toast({ title: 'Не удалось загрузить исполнителей', description: error.message, variant: 'destructive' }); return; }
    setRows(data ?? []); setTotal(count ?? 0);
  }, [orgId, page, search, status, tax, citizenship, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search, status, tax, citizenship, orgId]);

  // Выгрузка в Excel: вся база по текущим фильтрам, а не только страница.
  const exportCsv = async () => {
    if (!orgId) return;
    let q = db('workers').select('full_name,phone,city,status,tax_status,citizenship,rating,admitted_at').eq('org_id', orgId).order('full_name').limit(10000);
    if (status !== ALL) q = q.eq('status', status);
    if (tax !== ALL) q = q.eq('tax_status', tax);
    if (citizenship === 'foreign') q = q.not('citizenship', 'in', '(Россия,РФ,Российская Федерация)').not('citizenship', 'is', null);
    if (citizenship === 'ru') q = q.in('citizenship', ['Россия', 'РФ', 'Российская Федерация']);
    const term = search.trim().replace(/[%,()]/g, ' ');
    if (term) q = q.or(`full_name.ilike.%${term}%,phone.ilike.%${term}%`);
    const { data, error } = await q;
    if (error) { toast({ title: 'Не удалось выгрузить', description: error.message, variant: 'destructive' }); return; }
    downloadExcel('ispolniteli.xlsx', ['ФИО', 'Телефон', 'Город', 'Статус', 'Налоговый статус', 'Гражданство', 'Рейтинг', 'Допущен'],
      (data ?? []).map((w: WorkerRow) => [w.full_name, w.phone, w.city, WORKER_STATUSES[w.status], w.tax_status ? TAX[w.tax_status] : '', w.citizenship, w.rating, w.admitted_at ? fmtDate(w.admitted_at.slice(0, 10)) : '']));
  };

  const loadActivation = useCallback(async (kind: string) => {
    if (!orgId) return;
    const { data, error } = await rpc('worker_activation_list', { _org_id: orgId, _kind: kind });
    if (error) { toast({ title: 'Список недоступен', description: error.message, variant: 'destructive' }); return; }
    setActivation({ kind, rows: data ?? [] });
  }, [orgId, toast]);

  const loadReferrals = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await rpc('referral_report', { _org_id: orgId });
    if (error) { toast({ title: 'Отчёт недоступен', description: error.message, variant: 'destructive' }); return; }
    setReferrals(data ?? []);
  }, [orgId, toast]);

  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <AppLayout>
      <PageMeta title="Исполнители" description="База исполнителей" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div><h1 className="text-3xl font-bold mb-2">Исполнители</h1><p className="text-muted-foreground">База допущенных исполнителей, списки для обзвона и приведённые по рекомендации.</p></div>
        <Tabs defaultValue="list" onValueChange={(v) => { if (v === 'activation') loadActivation(activation.kind); if (v === 'referrals') loadReferrals(); }}>
          <TabsList>
            <TabsTrigger value="list">База</TabsTrigger>
            {can('workers', 'view') && <TabsTrigger value="activation">Активация</TabsTrigger>}
            {can('workers', 'view') && <TabsTrigger value="referrals">Рефералы</TabsTrigger>}
          </TabsList>

          <TabsContent value="list">
            <Card><CardContent className="pt-6 space-y-4">
              <div className="flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-56"><Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" /><Input className="pl-9" placeholder="ФИО или телефон" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск" /></div>
                <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-44" aria-label="Статус"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Все статусы</SelectItem>{Object.entries(WORKER_STATUSES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
                <Select value={tax} onValueChange={setTax}><SelectTrigger className="w-48" aria-label="Налоговый статус"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Любой налоговый статус</SelectItem>{Object.entries(TAX).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select>
                <Select value={citizenship} onValueChange={setCitizenship}><SelectTrigger className="w-44" aria-label="Гражданство"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Любое гражданство</SelectItem><SelectItem value="ru">Россия</SelectItem><SelectItem value="foreign">Иностранные</SelectItem></SelectContent></Select>
                <Button variant="outline" className="gap-2" onClick={exportCsv}><Download className="w-4 h-4" /> В Excel</Button>
              </div>
              {permsLoading ? <p className="text-muted-foreground">Загрузка…</p> : (<>
                <Table>
                  <TableHeader><TableRow><TableHead>Исполнитель</TableHead><TableHead>Статус</TableHead><TableHead>Налоговый статус</TableHead><TableHead>Гражданство</TableHead><TableHead>Рейтинг</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {rows.map((w) => (
                      <TableRow key={w.user_id}>
                        <TableCell><Link to={`/workers/${w.user_id}`} className="font-medium hover:underline">{w.full_name}</Link><div className="text-xs text-muted-foreground">{w.phone ?? '—'}{w.city ? ` · ${w.city}` : ''}</div></TableCell>
                        <TableCell><Badge variant={w.status === 'active' ? 'default' : 'secondary'}>{WORKER_STATUSES[w.status]}</Badge></TableCell>
                        <TableCell>{w.tax_status ? TAX[w.tax_status] : <span className="text-destructive">не указан</span>}</TableCell>
                        <TableCell>{w.citizenship ?? '—'}</TableCell>
                        <TableCell>{w.rating ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                    {!rows.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Исполнителей не найдено.</TableCell></TableRow>}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Всего: {total}</span>
                  <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</Button><span>{page + 1} / {pages}</span><Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Вперёд</Button></div>
                </div>
              </>)}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="activation">
            <Card><CardContent className="pt-6 space-y-4">
              <Select value={activation.kind} onValueChange={loadActivation}>
                <SelectTrigger className="w-80" aria-label="Список"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="no_shift_14">Допущен, но ни одной смены за 14 дней</SelectItem><SelectItem value="idle_30">Не выходил 30 дней</SelectItem></SelectContent>
              </Select>
              <Table>
                <TableHeader><TableRow><TableHead>Исполнитель</TableHead><TableHead>Телефон</TableHead><TableHead>Допущен</TableHead><TableHead>Последняя смена</TableHead></TableRow></TableHeader>
                <TableBody>
                  {activation.rows.map((r) => (<TableRow key={r.worker_id}><TableCell><Link to={`/workers/${r.worker_id}`} className="font-medium hover:underline">{r.full_name}</Link></TableCell><TableCell>{r.phone ?? '—'}</TableCell><TableCell>{r.admitted_at ? fmtDate(r.admitted_at.slice(0, 10)) : '—'}</TableCell><TableCell>{r.last_shift_at ? fmtDate(r.last_shift_at.slice(0, 10)) : '—'}</TableCell></TableRow>))}
                  {!activation.rows.length && <TableRow><TableCell colSpan={4} className="text-muted-foreground">В списке никого нет.</TableCell></TableRow>}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">Рассылка открытых смен выбранной группе появится вместе с уведомлениями.</p>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="referrals">
            <Card><CardContent className="pt-6">
              <Table>
                <TableHeader><TableRow><TableHead>Кто привёл</TableHead><TableHead>Приведённый</TableHead><TableHead>Смен отработано</TableHead><TableHead>Бонус</TableHead></TableRow></TableHeader>
                <TableBody>
                  {referrals.map((r) => (<TableRow key={r.referred_id}><TableCell>{r.referrer_name}</TableCell><TableCell>{r.referred_name}</TableCell><TableCell>{r.shifts_worked}</TableCell><TableCell>{r.qualifies ? <Badge>основание есть (5 смен)</Badge> : <span className="text-muted-foreground">пока нет</span>}</TableCell></TableRow>))}
                  {!referrals.length && <TableRow><TableCell colSpan={4} className="text-muted-foreground">Приведённых по рекомендации пока нет.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default WorkersList;
