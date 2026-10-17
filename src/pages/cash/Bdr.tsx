import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { db, rpc } from '@/lib/db';
import { downloadExcel } from '@/lib/csv';
import { fmtMoney } from '@/lib/format';
import PageMeta from '@/components/PageMeta';
import { Download } from 'lucide-react';

interface Row { month: string; article: string; article_name: string; sort_order: number; plan: number; fact: number }
interface Slice { key: string; name: string; revenue: number; worker_costs: number; margin: number; margin_pct: number | null; revenue_plan: number | null }
interface Plan { month: string; article: string; client_id: string | null; amount: number }

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const mlabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const COSTS = new Set(['worker_costs', 'worker_taxes', 'payout_fees', 'other_staff_costs', 'rotation_costs', 'admin_costs', 'usn_tax']);
const PLAN_ARTICLES: [string, string][] = [
  ['revenue', 'Выручка'], ['worker_costs', 'Затраты на исполнителей'], ['worker_taxes', 'Налоги и взносы по исполнителям'],
  ['payout_fees', 'Комиссии выплат'], ['other_staff_costs', 'Прочие расходы на персонал'], ['rotation_costs', 'Проживание и питание вахт'], ['admin_costs', 'Управленческие расходы'],
];
const DIMENSIONS: [string, string][] = [['client', 'Заказчики'], ['site', 'Объекты'], ['manager', 'Менеджеры продаж'], ['org', 'Организации']];

// Отклонение: для доходов плюс — хорошо, для расходов плюс — перерасход.
const deviation = (r: { article: string; plan: number; fact: number }) => r.fact - r.plan;
const devPct = (r: { plan: number; fact: number }) => (r.plan ? Math.round(((r.fact - r.plan) / r.plan) * 1000) / 10 : null);
const bad = (r: { article: string; plan: number; fact: number }) => (COSTS.has(r.article) ? r.fact > r.plan : r.fact < r.plan);

// Ф-6…Ф-8: БДР — факт из начислений и ДДС, план по месяцам и заказчикам, план/факт со срезами.
const Bdr: React.FC = () => {
  const { toast } = useToast();
  const { orgId, orgs } = useOrg();
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(`${year}-12-31`);
  const [scope, setScope] = useState<'one' | 'all'>('one');
  const [rows, setRows] = useState<Row[]>([]);
  const [dimension, setDimension] = useState('client');
  const [slices, setSlices] = useState<Slice[]>([]);
  const ids = useMemo(() => (scope === 'all' ? orgs.map((o) => o.id) : orgId ? [orgId] : []), [scope, orgs, orgId]);

  const load = useCallback(async () => {
    if (!ids.length) return;
    const [r, s] = await Promise.all([
      rpc('bdr_report', { _org_ids: ids, _from: from, _to: to }),
      rpc('bdr_breakdown', { _org_ids: ids, _from: from, _to: to, _dimension: dimension }),
    ]);
    if (r.error) { toast({ title: 'Не удалось построить БДР', description: r.error.message, variant: 'destructive' }); return; }
    setRows((r.data ?? []).map((x: Row) => ({ ...x, plan: Number(x.plan), fact: Number(x.fact) })));
    setSlices(s.error ? [] : (s.data ?? []).map((x: Slice) => ({ ...x, revenue: Number(x.revenue), worker_costs: Number(x.worker_costs), margin: Number(x.margin), revenue_plan: x.revenue_plan === null || x.revenue_plan === undefined ? null : Number(x.revenue_plan) })));
  }, [ids, from, to, dimension, toast]);

  useEffect(() => { load(); }, [load]);

  const months = Array.from(new Set(rows.map((r) => r.month))).sort();
  const articles = Array.from(new Map(rows.map((r) => [r.article, r])).values()).sort((a, b) => a.sort_order - b.sort_order);
  const totals = articles.map((a) => {
    const mine = rows.filter((r) => r.article === a.article);
    return { article: a.article, name: a.article_name, plan: mine.reduce((s, r) => s + r.plan, 0), fact: mine.reduce((s, r) => s + r.fact, 0) };
  });
  const cell = (a: string, m: string) => rows.find((r) => r.article === a && r.month === m);

  const exportCsv = () => {
    const header = ['Статья', 'План', 'Факт', 'Отклонение, ₽', 'Отклонение, %', ...months.flatMap((m) => [`${mlabel(m)} план`, `${mlabel(m)} факт`, `${mlabel(m)} откл., ₽`, `${mlabel(m)} откл., %`])];
    const body = totals.map((t) => [t.name, t.plan, t.fact, deviation(t), devPct(t) ?? '', ...months.flatMap((m) => { const c = cell(t.article, m); return [c?.plan ?? 0, c?.fact ?? 0, c ? deviation(c) : 0, c ? devPct(c) ?? '' : '']; })]);
    downloadExcel(`bdr-${from}-${to}.xlsx`, header, body);
  };
  const exportSlices = () => downloadExcel(`bdr-${dimension}-${from}-${to}.xlsx`, ['Название', 'План выручки', 'Выручка', 'Затраты на исполнителей', 'Маржа', 'Маржа, %'],
    slices.map((s) => [s.name, s.revenue_plan ?? '', s.revenue, s.worker_costs, s.margin, s.margin_pct ?? '']));

  return (
    <AppLayout>
      <PageMeta title="БДР" description="Бюджет доходов и расходов: план, факт, отклонения" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">БДР: план и факт</h1>
            <p className="text-muted-foreground">Выручка и затраты на исполнителей — по начислениям за даты смен, прочие расходы — по ДДС. Налог по УСН — оценка по режиму организации.</p>
          </div>
          <Button variant="ghost" asChild><Link to="/cash">К деньгам</Link></Button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="b-from">С</Label><Input id="b-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="b-to">По</Label><Input id="b-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          {orgs.length > 1 && (
            <Select value={scope} onValueChange={(v) => setScope(v as 'one' | 'all')}>
              <SelectTrigger className="w-60" aria-label="Организации"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="one">Текущая организация</SelectItem><SelectItem value="all">Все мои организации (суммарно)</SelectItem></SelectContent>
            </Select>
          )}
        </div>

        <Tabs defaultValue="report">
          <TabsList>
            <TabsTrigger value="report">План/факт</TabsTrigger>
            <TabsTrigger value="slices">Разрезы</TabsTrigger>
            <TabsTrigger value="plan">План</TabsTrigger>
          </TabsList>

          <TabsContent value="report">
            <Card><CardContent className="pt-6 overflow-x-auto space-y-3">
              <div className="flex justify-end"><Button variant="outline" className="gap-2" onClick={exportCsv} disabled={!rows.length}><Download className="w-4 h-4" /> В Excel</Button></div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Статья</TableHead><TableHead className="text-right">План</TableHead><TableHead className="text-right">Факт</TableHead>
                    <TableHead className="text-right">Отклонение</TableHead><TableHead className="text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {totals.map((t) => {
                    const strong = ['operating_profit', 'net_profit'].includes(t.article);
                    return (
                      <TableRow key={t.article} className={strong ? 'font-semibold bg-muted/40' : ''}>
                        <TableCell>{t.name}</TableCell>
                        <TableCell className="text-right">{fmtMoney(t.plan)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(t.fact)}</TableCell>
                        <TableCell className={`text-right ${t.plan && bad(t) ? 'text-destructive' : ''}`}>{fmtMoney(deviation(t))}</TableCell>
                        <TableCell className={`text-right ${t.plan && bad(t) ? 'text-destructive' : ''}`}>{devPct(t) === null ? '—' : `${devPct(t)}%`}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {!rows.length && <p className="text-sm text-muted-foreground">За период данных нет.</p>}
              {months.length > 0 && (
                <>
                  <h2 className="text-lg font-semibold pt-4">По месяцам</h2>
                  <Table>
                    <TableHeader><TableRow><TableHead>Статья</TableHead>{months.map((m) => <TableHead key={m} className="text-right">{mlabel(m)}</TableHead>)}</TableRow></TableHeader>
                    <TableBody>
                      {articles.map((a) => (
                        <TableRow key={a.article}>
                          <TableCell>{a.article_name}</TableCell>
                          {months.map((m) => {
                            const c = cell(a.article, m);
                            return (
                              <TableCell key={m} className="text-right whitespace-nowrap">
                                <div className={c && c.plan && bad({ article: a.article, ...c }) ? 'text-destructive' : ''}>{fmtMoney(c?.fact ?? 0)}</div>
                                <div className="text-xs text-muted-foreground">план {fmtMoney(c?.plan ?? 0)}</div>
                                {c && c.plan > 0 && <div className={`text-xs ${bad({ article: a.article, ...c }) ? 'text-destructive' : 'text-muted-foreground'}`}>{deviation({ article: a.article, ...c }) > 0 ? '+' : ''}{fmtMoney(deviation({ article: a.article, ...c }))} ({devPct(c)}%)</div>}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="slices">
            <Card><CardContent className="pt-6 overflow-x-auto space-y-3">
              <div className="flex flex-wrap justify-between gap-3">
                <Select value={dimension} onValueChange={setDimension}>
                  <SelectTrigger className="w-60" aria-label="Разрез"><SelectValue /></SelectTrigger>
                  <SelectContent>{DIMENSIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="outline" className="gap-2" onClick={exportSlices} disabled={!slices.length}><Download className="w-4 h-4" /> В Excel</Button>
              </div>
              <Table>
                <TableHeader><TableRow><TableHead>Название</TableHead>{dimension === 'client' && <TableHead className="text-right">План выручки</TableHead>}<TableHead className="text-right">Выручка</TableHead><TableHead className="text-right">Затраты на исполнителей</TableHead><TableHead className="text-right">Маржа</TableHead><TableHead className="text-right">%</TableHead></TableRow></TableHeader>
                <TableBody>
                  {slices.map((s) => (
                    <TableRow key={s.key}>
                      <TableCell>{s.name}</TableCell>
                      {dimension === 'client' && <TableCell className="text-right">{s.revenue_plan === null ? '—' : fmtMoney(s.revenue_plan)}</TableCell>}
                      <TableCell className="text-right">{fmtMoney(s.revenue)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(s.worker_costs)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(s.margin)}</TableCell>
                      <TableCell className="text-right">{s.margin_pct === null ? '—' : `${s.margin_pct}%`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!slices.length && <p className="text-sm text-muted-foreground">За период данных нет.</p>}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="plan">
            <PlanEditor orgId={orgId} onSaved={load} />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
};

// Редактор плана на год: статьи × месяцы; выручку можно вести по заказчикам. Копирование факта прошлого года с ростом.
const PlanEditor: React.FC<{ orgId: string | null; onSaved: () => void }> = ({ orgId, onSaved }) => {
  const { toast } = useToast();
  const [year, setYear] = useState(new Date().getFullYear());
  const [clientId, setClientId] = useState('all');
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [growth, setGrowth] = useState('10');
  const [version, setVersion] = useState(0);
  const monthKeys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [p, c] = await Promise.all([
      db('bdr_plans').select('month, article, client_id, amount').eq('org_id', orgId).gte('month', `${year}-01-01`).lte('month', `${year}-12-01`),
      db('clients').select('id, name').eq('org_id', orgId).order('name'),
    ]);
    setPlans(((p.data ?? []) as Plan[]).map((x) => ({ ...x, amount: Number(x.amount) })));
    setClients((c.data ?? []) as { id: string; name: string }[]);
  }, [orgId, year]);

  useEffect(() => { load(); }, [load]);

  const value = (article: string, month: string) => {
    const cid = article === 'revenue' && clientId !== 'all' ? clientId : null;
    return plans.find((p) => p.article === article && p.month === month && p.client_id === cid)?.amount;
  };

  const save = async (article: string, month: string, raw: string) => {
    if (!orgId) return;
    const cid = article === 'revenue' && clientId !== 'all' ? clientId : null;
    const amount = Number(raw.replace(/\s/g, '').replace(',', '.') || 0);
    if (Number.isNaN(amount) || amount < 0) { toast({ title: 'Сумма должна быть числом не меньше нуля', variant: 'destructive' }); return; }
    if (value(article, month) === amount || (value(article, month) === undefined && !amount)) return;
    const { error } = await rpc('save_bdr_plan', { _org_id: orgId, _month: month, _article: article, _amount: amount, _client_id: cid });
    if (error) { toast({ title: 'Не удалось сохранить', description: error.message, variant: 'destructive' }); return; }
    await load(); onSaved();
  };

  const copy = async () => {
    if (!orgId) return;
    if (!window.confirm(`Заменить весь план ${year} года фактом ${year - 1} года с ростом ${growth}%?`)) return;
    const { data, error } = await rpc('copy_bdr_plan', { _org_id: orgId, _from_year: year - 1, _to_year: year, _growth_pct: Number(growth || 0) });
    if (error) { toast({ title: 'Не удалось скопировать', description: error.message, variant: 'destructive' }); return; }
    toast({ title: `План ${year} года создан`, description: `Строк: ${data}` });
    setVersion((v) => v + 1);
    await load(); onSaved();
  };

  return (
    <Card><CardContent className="pt-6 space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div><Label htmlFor="p-year">Год</Label><Input id="p-year" type="number" className="w-28" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} /></div>
        <div>
          <Label htmlFor="p-client">Выручка по</Label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger id="p-client" className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">Общий план (без разбивки)</SelectItem>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <div><Label htmlFor="p-growth">Рост, %</Label><Input id="p-growth" type="number" className="w-24" value={growth} onChange={(e) => setGrowth(e.target.value)} /></div>
          <Button variant="outline" onClick={copy}>Взять факт {year - 1} года</Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">План выручки — сумма общего плана и планов по заказчикам. Расходы вводятся только в общем плане. Сохраняется при выходе из ячейки.</p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Статья</TableHead>{monthKeys.map((m) => <TableHead key={m} className="text-right">{mlabel(m)}</TableHead>)}</TableRow></TableHeader>
          <TableBody>
            {PLAN_ARTICLES.map(([article, name]) => {
              const editable = article === 'revenue' || clientId === 'all';
              return (
                <TableRow key={article}>
                  <TableCell className="whitespace-nowrap">{name}</TableCell>
                  {monthKeys.map((m) => (
                    <TableCell key={`${year}-${clientId}-${m}-${version}`} className="p-1">
                      <Input
                        aria-label={`${name}, ${mlabel(m)}`} className="h-8 w-24 text-right" inputMode="decimal" disabled={!editable}
                        defaultValue={value(article, m) ?? ''} onBlur={(e) => save(article, m, e.target.value)}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </CardContent></Card>
  );
};

export default Bdr;
