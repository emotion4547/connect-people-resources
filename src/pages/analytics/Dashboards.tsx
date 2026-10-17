import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';
import { useToast } from '@/hooks/use-toast';
import { rpc } from '@/lib/db';
import { downloadExcel } from '@/lib/csv';
import { addDays, fmtDate, fmtMoney, monthEnd, monthStart, today } from '@/lib/format';
import PageMeta from '@/components/PageMeta';
import { MetricGrid } from '@/components/analytics/MetricGrid';
import { TrendChart } from '@/components/analytics/TrendChart';
import { stageLabel } from '@/lib/dealMeta';
import { Download } from 'lucide-react';

interface ClientRow { client_id: string; client_name: string; revenue: number; margin: number; margin_pct: number | null; prev_margin_pct: number | null; margin_falling: boolean }
interface SiteRow { site_id: string; site_name: string; client_name: string; needed: number; confirmed: number; started_needed: number; on_site: number; started_assigned: number; no_shows: number; today_needed: number; today_confirmed: number; week_needed: number; week_confirmed: number }
interface Unconfirmed { assignment_id: string; worker_name: string; phone: string | null; site_name: string; client_name: string; shift_start: string; order_id: string }
interface Cand { dimension: string; key: string; name: string; total: number; admitted: number }
interface Counter { key: string; name: string; unit: string; value: number | null; link: string | null; grp: string }
interface PlanFact { revenue_plan: number | null; revenue_fact: number; margin_plan: number | null; margin_fact: number }
interface Funnel { stage: string; deals: number; revenue: number; weighted: number }
interface Lost { reason: string; deals: number }
interface Receivable { debt: number; not_due: number; overdue_30: number; overdue_60: number; overdue_60p: number }

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '—');
const num = (v: unknown) => Number(v ?? 0);

const TABS = [
  { id: 'director', label: 'Руководитель', roles: ['director'] },
  { id: 'sites', label: 'Ведение объектов', roles: ['director', 'site_manager'] },
  { id: 'hiring', label: 'Найм', roles: ['director', 'recruiter'] },
  { id: 'sales', label: 'Продажи', roles: ['director', 'sales'] },
  { id: 'accounting', label: 'Бухгалтерия', roles: ['director', 'accountant'] },
];

const Dashboards: React.FC = () => {
  const { role } = useAuth();
  const { orgId, orgs } = useOrg();
  const { toast } = useToast();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [scope, setScope] = useState<'one' | 'all'>('one');
  const ids = useMemo(() => (scope === 'all' ? orgs.map((o) => o.id) : orgId ? [orgId] : []), [scope, orgs, orgId]);
  const tabs = TABS.filter((t) => role && t.roles.includes(role));
  const [tab, setTab] = useState<string>('');
  const current = tab || tabs[0]?.id || '';

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [unconfirmed, setUnconfirmed] = useState<Unconfirmed[]>([]);
  const [cands, setCands] = useState<Cand[]>([]);
  const [counters, setCounters] = useState<Counter[]>([]);
  const [plan, setPlan] = useState<PlanFact | null>(null);
  const [funnel, setFunnel] = useState<Funnel[]>([]);
  const [lost, setLost] = useState<Lost[]>([]);
  const [aging, setAging] = useState<Receivable | null>(null);
  const [cash, setCash] = useState<{ balance: number; gapDay: string | null; gapDepth: number } | null>(null);

  const call = useCallback(async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await rpc(fn, args);
    if (error) { if (error.code !== '42501') toast({ title: 'Не удалось загрузить данные', description: error.message, variant: 'destructive' }); return null; }
    return data;
  }, [toast]);

  useEffect(() => {
    if (!ids.length || !current) return;
    const base = { _org_ids: ids, _from: from, _to: to };
    (async () => {
      setCounters(((await call('analytics_counters', base)) ?? []).map((c: Counter) => ({ ...c, value: c.value === null ? null : num(c.value) })));
      if (['director', 'sales'].includes(current)) {
        setClients(((await call('analytics_by_client', base)) ?? []).map((c: ClientRow) => ({ ...c, revenue: num(c.revenue), margin: num(c.margin) })));
        const p = await call('analytics_plan_fact', base);
        setPlan(p?.[0] ? { revenue_plan: p[0].revenue_plan === null ? null : num(p[0].revenue_plan), revenue_fact: num(p[0].revenue_fact), margin_plan: p[0].margin_plan === null ? null : num(p[0].margin_plan), margin_fact: num(p[0].margin_fact) } : null);
      }
      if (current === 'sales' && orgId) {
        setFunnel(((await call('deal_funnel', { _org_id: orgId })) ?? []).map((x: Funnel) => ({ ...x, deals: num(x.deals), revenue: num(x.revenue), weighted: num(x.weighted) })));
        setLost(((await call('deal_lost_reasons', { _org_id: orgId, _from: from, _to: to })) ?? []).map((x: Lost) => ({ ...x, deals: num(x.deals) })));
      }
      if (current === 'sites') {
        setSites(((await call('analytics_by_site', base)) ?? []).map((s: SiteRow) => ({ ...s, needed: num(s.needed), confirmed: num(s.confirmed), started_needed: num(s.started_needed), on_site: num(s.on_site), started_assigned: num(s.started_assigned), no_shows: num(s.no_shows), today_needed: num(s.today_needed), today_confirmed: num(s.today_confirmed), week_needed: num(s.week_needed), week_confirmed: num(s.week_confirmed) })));
        setUnconfirmed((await call('analytics_unconfirmed', { _org_ids: ids, _day: addDays(today(), 1) })) ?? []);
      }
      if (current === 'hiring') setCands(((await call('analytics_candidates', base)) ?? []).map((c: Cand) => ({ ...c, total: num(c.total), admitted: num(c.admitted) })));
      if (current === 'accounting') {
        const r: Receivable[] | null = await call('client_receivables', {});
        setAging(r ? r.reduce((s, x) => ({ debt: s.debt + num(x.debt), not_due: s.not_due + num(x.not_due), overdue_30: s.overdue_30 + num(x.overdue_30), overdue_60: s.overdue_60 + num(x.overdue_60), overdue_60p: s.overdue_60p + num(x.overdue_60p) }), { debt: 0, not_due: 0, overdue_30: 0, overdue_60: 0, overdue_60p: 0 }) : null);
      }
      if (current === 'director' && orgId) {
        const [bal, cal] = await Promise.all([call('cash_total_balance', { _org_ids: [orgId], _date: today() }), call('payment_calendar', { _org_id: orgId, _from: today(), _days: 28 })]);
        const gap = (cal ?? []).filter((d: { gap: boolean }) => d.gap);
        setCash({ balance: num(bal), gapDay: gap[0]?.day ?? null, gapDepth: gap.length ? Math.min(...gap.map((d: { balance_close: number }) => num(d.balance_close))) : 0 });
      }
    })();
  }, [ids, from, to, current, orgId, call]);

  const counterCards = (grp: string, only?: string[]) => {
    const list = counters.filter((c) => c.grp === grp && (!only || only.includes(c.key)));
    if (!list.length) return null;
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {list.map((c) => (
          <Card key={c.key}><CardContent className="pt-5">
            <p className="text-sm text-muted-foreground">{c.name}</p>
            {c.link ? <Link to={c.link} className="text-2xl font-bold mt-1 block hover:underline">{c.unit === '₽' ? fmtMoney(c.value) : `${c.value ?? '—'} ${c.unit === '★' ? '★' : ''}`}</Link>
              : <p className="text-2xl font-bold mt-1">{c.value === null ? '—' : `${c.value} ${c.unit}`}</p>}
          </CardContent></Card>
        ))}
      </div>
    );
  };

  const exportClients = () => downloadExcel(`clients-${from}-${to}.xlsx`, ['Заказчик', 'Выручка', 'Маржа', 'Маржа, %', 'Прошлый период, %'], clients.map((c) => [c.client_name, c.revenue, c.margin, c.margin_pct ?? '', c.prev_margin_pct ?? '']));
  const exportSites = () => downloadExcel(`sites-${from}-${to}.xlsx`, ['Заказчик', 'Объект', 'Нужно', 'Подтвердили', 'На месте', 'Неявки'], sites.map((s) => [s.client_name, s.site_name, s.needed, s.confirmed, s.on_site, s.no_shows]));

  const planCard = plan && (
    <div className="grid gap-4 sm:grid-cols-2">
      {[['Выручка', plan.revenue_plan, plan.revenue_fact], ['Маржа', plan.margin_plan, plan.margin_fact]].map(([name, p, f]) => (
        <Card key={name as string}><CardContent className="pt-5">
          <p className="text-sm text-muted-foreground">{name as string}: факт против плана</p>
          <p className="text-2xl font-bold mt-1">{fmtMoney(f as number)}</p>
          <p className="text-xs text-muted-foreground mt-2">{p === null ? 'План не задан' : `План ${fmtMoney(p as number)} · выполнено ${pct(f as number, p as number)}`}</p>
        </CardContent></Card>
      ))}
    </div>
  );

  if (!tabs.length) return <AppLayout><p className="p-6">Для вашей роли дашборд не предусмотрен.</p></AppLayout>;

  return (
    <AppLayout>
      <PageMeta title="Дашборды" description="Показатели отделов" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Дашборды</h1>
          <p className="text-muted-foreground">Показатели отдела за период в сравнении с прошлым. Нажмите на число, чтобы увидеть записи, из которых оно сложилось.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="d-from">С</Label><Input id="d-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="d-to">По</Label><Input id="d-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button variant="outline" onClick={() => { setTo(today()); setFrom(addDays(today(), -6)); }}>7 дней</Button>
          <Button variant="outline" onClick={() => { setFrom(monthStart()); setTo(monthEnd()); }}>Месяц</Button>
          {orgs.length > 1 && (
            <Select value={scope} onValueChange={(v) => setScope(v as 'one' | 'all')}>
              <SelectTrigger className="w-60" aria-label="Организации"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="one">Текущая организация</SelectItem><SelectItem value="all">Все мои организации (суммарно)</SelectItem></SelectContent>
            </Select>
          )}
        </div>

        <Tabs value={current} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto">{tabs.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}</TabsList>

          <TabsContent value="director" className="space-y-6">
            <MetricGrid orgIds={ids} from={from} to={to} only={['revenue', 'margin_amount', 'margin_pct', 'staffing', 'no_show', 'overdue_receivables']} />
            {planCard}
            <TrendChart orgIds={ids} />
            {cash && (
              <Card><CardContent className="pt-5 flex flex-wrap items-center justify-between gap-3">
                <div><p className="text-sm text-muted-foreground">Остаток денег</p><p className="text-2xl font-bold">{fmtMoney(cash.balance)}</p></div>
                <div className="text-sm">{cash.gapDay ? <span className="text-destructive">Ближайший кассовый разрыв: {fmtDate(cash.gapDay)}, глубина {fmtMoney(cash.gapDepth)}</span> : <span className="text-muted-foreground">В ближайшие 4 недели разрыва нет</span>}</div>
                <Button asChild variant="outline"><Link to="/cash/calendar">Платёжный календарь</Link></Button>
              </CardContent></Card>
            )}
            <ClientTables clients={clients} onExport={exportClients} />
          </TabsContent>

          <TabsContent value="sites" className="space-y-6">
            <MetricGrid orgIds={ids} from={from} to={to} only={['staffing', 'attendance', 'no_show', 'order_close_hours']} />
            {counterCards('ops', ['unconfirmed_tomorrow', 'timesheets_pending', 'timesheets_disputed', 'rating_avg'])}
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-lg">Укомплектованность по объектам</CardTitle>
                <Button variant="outline" size="sm" className="gap-2" onClick={exportSites} disabled={!sites.length}><Download className="w-4 h-4" /> Excel</Button></CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Объект</TableHead><TableHead className="text-right">Сегодня</TableHead><TableHead className="text-right">Неделя вперёд</TableHead><TableHead className="text-right">Период</TableHead><TableHead className="text-right">Выход</TableHead><TableHead className="text-right">Неявки</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {sites.map((s) => (
                      <TableRow key={s.site_id}>
                        <TableCell>{s.site_name}<div className="text-xs text-muted-foreground">{s.client_name}</div></TableCell>
                        <TableCell className="text-right">{s.today_needed ? `${s.today_confirmed} / ${s.today_needed}` : '—'}</TableCell>
                        <TableCell className="text-right">{s.week_needed ? `${s.week_confirmed} / ${s.week_needed}` : '—'}</TableCell>
                        <TableCell className="text-right">{pct(s.confirmed, s.needed)}</TableCell>
                        <TableCell className="text-right">{pct(s.on_site, s.started_needed)}</TableCell>
                        <TableCell className="text-right">{s.started_assigned ? `${s.no_shows} (${pct(s.no_shows, s.started_assigned)})` : '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {!sites.length && <p className="text-sm text-muted-foreground mt-3">Смен за период нет.</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-lg">Не подтвердили выход на завтра</CardTitle></CardHeader>
              <CardContent>
                {unconfirmed.map((u) => (
                  <div key={u.assignment_id} className="flex flex-wrap justify-between gap-2 py-2 border-b last:border-0 text-sm">
                    <span><Link className="hover:underline" to={`/orders/${u.order_id}`}>{u.worker_name}</Link> · {u.client_name}, {u.site_name}</span>
                    <span className="text-muted-foreground">{u.phone ?? 'телефон не указан'}</span>
                  </div>
                ))}
                {!unconfirmed.length && <p className="text-sm text-muted-foreground">Все подтвердили.</p>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="hiring" className="space-y-6">
            <MetricGrid orgIds={ids} from={from} to={to} only={['hire_conversion', 'time_to_admit_days', 'active_base', 'retention_30', 'retention_60', 'retention_90']} />
            {counterCards('hire')}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card><CardHeader><CardTitle className="text-lg">Новые кандидаты по источникам</CardTitle></CardHeader><CardContent>
                <Table><TableHeader><TableRow><TableHead>Источник</TableHead><TableHead className="text-right">Кандидатов</TableHead><TableHead className="text-right">Допущено</TableHead><TableHead className="text-right">Конверсия</TableHead></TableRow></TableHeader>
                  <TableBody>{cands.filter((c) => c.dimension === 'source').map((c) => <TableRow key={c.key}><TableCell>{c.name}</TableCell><TableCell className="text-right">{c.total}</TableCell><TableCell className="text-right">{c.admitted}</TableCell><TableCell className="text-right">{pct(c.admitted, c.total)}</TableCell></TableRow>)}</TableBody></Table>
              </CardContent></Card>
              <Card><CardHeader><CardTitle className="text-lg">Кандидаты периода по этапам</CardTitle></CardHeader><CardContent>
                <Table><TableHeader><TableRow><TableHead>Этап</TableHead><TableHead className="text-right">Человек</TableHead></TableRow></TableHeader>
                  <TableBody>{cands.filter((c) => c.dimension === 'stage').map((c) => <TableRow key={c.key}><TableCell>{c.name}</TableCell><TableCell className="text-right">{c.total}</TableCell></TableRow>)}</TableBody></Table>
              </CardContent></Card>
            </div>
          </TabsContent>

          <TabsContent value="sales" className="space-y-6">
            {planCard}
            <MetricGrid orgIds={ids} from={from} to={to} only={['revenue', 'margin_amount', 'margin_pct']} />
            {counterCards('ops', ['idle_clients_30'])}
            <ClientTables clients={clients} onExport={exportClients} />
            <div className="grid gap-4 lg:grid-cols-2">
              <Card><CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-lg">Воронка сделок</CardTitle><Button asChild variant="link"><Link to="/deals">Открыть сделки</Link></Button></CardHeader><CardContent>
                <Table><TableHeader><TableRow><TableHead>Этап</TableHead><TableHead className="text-right">Сделок</TableHead><TableHead className="text-right">В месяц</TableHead><TableHead className="text-right">Взвешенно</TableHead></TableRow></TableHeader>
                  <TableBody>{funnel.map((f) => <TableRow key={f.stage}><TableCell>{stageLabel(f.stage)}</TableCell><TableCell className="text-right">{f.deals}</TableCell><TableCell className="text-right">{fmtMoney(f.revenue)}</TableCell><TableCell className="text-right">{fmtMoney(f.weighted)}</TableCell></TableRow>)}</TableBody></Table>
              </CardContent></Card>
              <Card><CardHeader><CardTitle className="text-lg">Причины отказов за период</CardTitle></CardHeader><CardContent>
                {lost.map((l) => <div key={l.reason} className="flex justify-between py-2 border-b last:border-0 text-sm"><span>{l.reason}</span><span>{l.deals}</span></div>)}
                {!lost.length && <p className="text-sm text-muted-foreground">Отказов за период нет.</p>}
              </CardContent></Card>
            </div>
          </TabsContent>

          <TabsContent value="accounting" className="space-y-6">
            {counterCards('fin')}
            <MetricGrid orgIds={ids} from={from} to={to} only={['overdue_receivables', 'receivables_total']} />
            {aging && (
              <Card><CardHeader><CardTitle className="text-lg">Дебиторка по срокам</CardTitle></CardHeader><CardContent>
                <Table><TableHeader><TableRow><TableHead className="text-right">Не наступил срок</TableHead><TableHead className="text-right">До 30 дней</TableHead><TableHead className="text-right">31–60</TableHead><TableHead className="text-right">Больше 60</TableHead><TableHead className="text-right">Всего</TableHead></TableRow></TableHeader>
                  <TableBody><TableRow><TableCell className="text-right">{fmtMoney(aging.not_due)}</TableCell><TableCell className="text-right">{fmtMoney(aging.overdue_30)}</TableCell><TableCell className="text-right">{fmtMoney(aging.overdue_60)}</TableCell><TableCell className="text-right text-destructive">{fmtMoney(aging.overdue_60p)}</TableCell><TableCell className="text-right font-medium">{fmtMoney(aging.debt)}</TableCell></TableRow></TableBody></Table>
                <Button asChild variant="link" className="px-0"><Link to="/receivables">Подробнее по заказчикам</Link></Button>
              </CardContent></Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

const ClientTables: React.FC<{ clients: ClientRow[]; onExport: () => void }> = ({ clients, onExport }) => (
  <div className="grid gap-4 lg:grid-cols-2">
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-lg">Топ-10 заказчиков</CardTitle>
        <Button variant="outline" size="sm" className="gap-2" onClick={onExport} disabled={!clients.length}><Download className="w-4 h-4" /> Excel</Button></CardHeader>
      <CardContent>
        <Table><TableHeader><TableRow><TableHead>Заказчик</TableHead><TableHead className="text-right">Выручка</TableHead><TableHead className="text-right">Маржа</TableHead><TableHead className="text-right">%</TableHead></TableRow></TableHeader>
          <TableBody>{clients.slice(0, 10).map((c) => (
            <TableRow key={c.client_id}><TableCell><Link className="hover:underline" to={`/clients/${c.client_id}`}>{c.client_name}</Link></TableCell><TableCell className="text-right">{fmtMoney(c.revenue)}</TableCell><TableCell className="text-right">{fmtMoney(c.margin)}</TableCell><TableCell className="text-right">{c.margin_pct === null ? '—' : `${c.margin_pct}%`}</TableCell></TableRow>
          ))}</TableBody></Table>
        {!clients.length && <p className="text-sm text-muted-foreground mt-3">За период начислений нет.</p>}
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle className="text-lg">Падает маржа</CardTitle></CardHeader>
      <CardContent>
        {clients.filter((c) => c.margin_falling).map((c) => (
          <div key={c.client_id} className="flex justify-between gap-3 py-2 border-b last:border-0 text-sm">
            <Link className="hover:underline" to={`/clients/${c.client_id}`}>{c.client_name}</Link>
            <span className="text-destructive">{c.prev_margin_pct}% → {c.margin_pct}%</span>
          </div>
        ))}
        {!clients.some((c) => c.margin_falling) && <p className="text-sm text-muted-foreground">Заказчиков с падающей маржой нет.</p>}
      </CardContent>
    </Card>
  </div>
);

export default Dashboards;
