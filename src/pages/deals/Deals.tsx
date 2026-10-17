import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';
import { useToast } from '@/hooks/use-toast';
import { db, rpc } from '@/lib/db';
import { downloadExcel } from '@/lib/csv';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { DEAL_STAGES, SOURCES, stageLabel, type Deal } from '@/lib/dealMeta';
import PageMeta from '@/components/PageMeta';
import { Download, Plus } from 'lucide-react';

interface DayRow { kind: string; ref_id: string; deal_id: string; deal_title: string; title: string; due: string; overdue: boolean }
interface Owner { user_id: string; full_name: string }
interface Fact { manager_id: string; manager_name: string; month: string; plan: number; fact: number }

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

// С-2, С-3, С-7: канбан сделок с суммами и взвешенной выручкой, «Мой день» менеджера, план продаж.
const Deals: React.FC = () => {
  const { user, role } = useAuth();
  const { orgId } = useOrg();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [deals, setDeals] = useState<Deal[]>([]);
  const [day, setDay] = useState<DayRow[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]);
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [showClosed, setShowClosed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', company: '', contact_name: '', contact_phone: '', contact_email: '', expected_revenue: '', expected_margin: '' });
  const [facts, setFacts] = useState<Fact[]>([]);
  const isDirector = role === 'director';
  const year = new Date().getFullYear();

  const load = useCallback(async () => {
    if (!orgId) return;
    const [d, m, o, f] = await Promise.all([
      db('deals').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
      rpc('my_sales_day', { _org_id: orgId }),
      db('staff_profiles').select('user_id, full_name'),
      rpc('sales_plan_fact', { _org_id: orgId, _from: `${year}-01-01`, _to: `${year}-12-31` }),
    ]);
    if (d.error) { toast({ title: 'Не удалось загрузить сделки', description: d.error.message, variant: 'destructive' }); return; }
    setDeals(((d.data ?? []) as Deal[]).map((x) => ({ ...x, expected_revenue: Number(x.expected_revenue), expected_margin: Number(x.expected_margin) })));
    setDay((m.data ?? []) as DayRow[]);
    setOwners((o.data ?? []) as Owner[]);
    setFacts(((f.data ?? []) as Fact[]).map((x) => ({ ...x, plan: Number(x.plan), fact: Number(x.fact) })));
  }, [orgId, toast, year]);

  useEffect(() => { load(); }, [load]);

  const ownerName = (id: string | null) => (id ? owners.find((o) => o.user_id === id)?.full_name ?? 'Менеджер' : 'Не назначен');
  const visible = useMemo(() => deals.filter((d) => ownerFilter === 'all' || (ownerFilter === 'none' ? !d.owner_id : d.owner_id === ownerFilter)), [deals, ownerFilter]);
  const column = (stage: string) => visible.filter((d) => d.stage === stage);
  const prob = (stage: string) => (DEAL_STAGES.find((s) => s.id === stage)?.probability ?? 0) / 100;

  const move = async (d: Deal, stage: string) => {
    if (stage === 'lost') { navigate(`/deals/${d.id}?lost=1`); return; }
    const { error } = await rpc('set_deal_stage', { _deal_id: d.id, _stage: stage });
    if (error) { toast({ title: 'Не удалось перенести сделку', description: error.message, variant: 'destructive' }); return; }
    load();
  };

  const create = async () => {
    if (!orgId || !user || !form.title.trim()) { toast({ title: 'Укажите название сделки', variant: 'destructive' }); return; }
    const { error } = await db('deals').insert({
      org_id: orgId, title: form.title.trim(), company: form.company || null, contact_name: form.contact_name || null, contact_phone: form.contact_phone || null,
      contact_email: form.contact_email || null, owner_id: user.id, expected_revenue: Number(form.expected_revenue || 0), expected_margin: Number(form.expected_margin || 0),
      next_step: 'Связаться с заказчиком', next_step_date: today(),
    });
    if (error) { toast({ title: 'Не удалось создать сделку', description: error.message, variant: 'destructive' }); return; }
    setCreating(false); setForm({ title: '', company: '', contact_name: '', contact_phone: '', contact_email: '', expected_revenue: '', expected_margin: '' }); load();
  };

  const savePlan = async (managerId: string, month: string, raw: string) => {
    if (!orgId) return;
    const amount = Number(raw.replace(/\s/g, '').replace(',', '.') || 0);
    if (Number.isNaN(amount) || amount < 0) { toast({ title: 'Сумма должна быть числом не меньше нуля', variant: 'destructive' }); return; }
    const { error } = await rpc('save_sales_plan', { _org_id: orgId, _manager_id: managerId, _month: month, _amount: amount });
    if (error) { toast({ title: 'Не удалось сохранить', description: error.message, variant: 'destructive' }); return; }
    load();
  };

  const managers = Array.from(new Map(facts.map((f) => [f.manager_id, f.manager_name])).entries());
  const monthKeys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`);
  const factCell = (m: string, k: string) => facts.find((f) => f.manager_id === m && f.month === k);

  const exportCsv = () => downloadExcel(`deals-${today()}.xlsx`, ['Сделка', 'Заказчик', 'Этап', 'Ответственный', 'Выручка в месяц', 'Маржа в месяц', 'Следующий шаг', 'Дата шага'],
    visible.map((d) => [d.title, d.company, stageLabel(d.stage), ownerName(d.owner_id), d.expected_revenue, d.expected_margin, d.next_step, d.next_step_date ? fmtDate(d.next_step_date) : '']));

  return (
    <AppLayout>
      <PageMeta title="Сделки" description="Воронка продаж" />
      <div className="max-w-7xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Сделки</h1>
            <p className="text-muted-foreground">Новые заявки с сайта и из саморегистрации попадают сюда сами. Сумма этапа — ожидаемая выручка в месяц, в скобках — взвешенная по вероятности этапа.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={exportCsv} disabled={!visible.length}><Download className="w-4 h-4" /> Excel</Button>
            <Button className="gap-2" onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Новая сделка</Button>
          </div>
        </div>

        <Tabs defaultValue="board">
          <TabsList><TabsTrigger value="board">Воронка</TabsTrigger><TabsTrigger value="day">Мой день{day.length ? ` (${day.length})` : ''}</TabsTrigger><TabsTrigger value="plan">План продаж</TabsTrigger></TabsList>

          <TabsContent value="board" className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center">
              {isDirector && (
                <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                  <SelectTrigger className="w-60" aria-label="Ответственный"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">Все менеджеры</SelectItem><SelectItem value="none">Без ответственного</SelectItem>
                    {owners.map((o) => <SelectItem key={o.user_id} value={o.user_id}>{o.full_name}</SelectItem>)}</SelectContent>
                </Select>
              )}
              <Button variant="outline" size="sm" onClick={() => setShowClosed((v) => !v)}>{showClosed ? 'Скрыть закрытые' : 'Показать выигранные и проигранные'}</Button>
            </div>
            <div className="grid gap-4 md:grid-cols-5 overflow-x-auto">
              {DEAL_STAGES.map((s) => {
                const list = column(s.id);
                const sum = list.reduce((a, d) => a + d.expected_revenue, 0);
                return (
                  <section key={s.id} className="min-w-[220px] space-y-2">
                    <div className="px-1">
                      <h2 className="font-semibold">{s.label} <span className="text-muted-foreground font-normal">· {list.length}</span></h2>
                      <p className="text-xs text-muted-foreground">{fmtMoney(sum)} ({fmtMoney(sum * prob(s.id))})</p>
                    </div>
                    {list.map((d) => (
                      <Card key={d.id}><CardContent className="p-3 space-y-2">
                        <Link to={`/deals/${d.id}`} className="font-medium hover:underline block">{d.title}</Link>
                        <div className="text-xs text-muted-foreground">{d.company ?? d.contact_name ?? ''}</div>
                        <div className="flex flex-wrap items-center gap-1 text-xs">
                          <Badge variant="secondary">{fmtMoney(d.expected_revenue)}</Badge>
                          {d.source !== 'manual' && <Badge variant="outline">{SOURCES[d.source]}</Badge>}
                        </div>
                        <div className="text-xs">{ownerName(d.owner_id)}{d.next_step_date && <span className={d.next_step_date < today() ? 'text-destructive' : 'text-muted-foreground'}> · {fmtDate(d.next_step_date)}</span>}</div>
                        <Select value={d.stage} onValueChange={(v) => move(d, v)}>
                          <SelectTrigger className="h-8 text-xs" aria-label="Перенести на этап"><SelectValue /></SelectTrigger>
                          <SelectContent>{DEAL_STAGES.map((x) => <SelectItem key={x.id} value={x.id}>{x.label}</SelectItem>)}<SelectItem value="lost">Проиграна…</SelectItem></SelectContent>
                        </Select>
                      </CardContent></Card>
                    ))}
                  </section>
                );
              })}
            </div>
            {showClosed && (
              <Card><CardHeader><CardTitle className="text-lg">Закрытые сделки</CardTitle></CardHeader><CardContent>
                <Table><TableHeader><TableRow><TableHead>Сделка</TableHead><TableHead>Итог</TableHead><TableHead>Ответственный</TableHead><TableHead className="text-right">Выручка в месяц</TableHead></TableRow></TableHeader>
                  <TableBody>{visible.filter((d) => ['won', 'lost'].includes(d.stage)).map((d) => (
                    <TableRow key={d.id}><TableCell><Link className="hover:underline" to={`/deals/${d.id}`}>{d.title}</Link></TableCell>
                      <TableCell>{stageLabel(d.stage)}{d.lost_reason ? `: ${d.lost_reason}` : ''}</TableCell><TableCell>{ownerName(d.owner_id)}</TableCell><TableCell className="text-right">{fmtMoney(d.expected_revenue)}</TableCell></TableRow>
                  ))}</TableBody></Table>
              </CardContent></Card>
            )}
          </TabsContent>

          <TabsContent value="day">
            <Card><CardContent className="pt-6 space-y-2">
              {day.map((r) => (
                <div key={`${r.kind}-${r.ref_id}`} className="flex flex-wrap justify-between gap-2 py-2 border-b last:border-0 text-sm">
                  <span><Link className="hover:underline font-medium" to={`/deals/${r.deal_id}`}>{r.deal_title}</Link> — {r.title}</span>
                  <span className={r.overdue ? 'text-destructive' : 'text-muted-foreground'}>{r.overdue ? 'просрочено, ' : ''}{fmtDate(r.due)}</span>
                </div>
              ))}
              {!day.length && <p className="text-sm text-muted-foreground">На сегодня задач и шагов нет.</p>}
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="plan">
            <Card><CardContent className="pt-6 overflow-x-auto space-y-3">
              <p className="text-sm text-muted-foreground">План — выручка новых заказчиков менеджера в месяц. Факт считается по начислениям заказчиков, заведённых за последние месяцы (настройка «Сколько месяцев заказчик считается новым»).</p>
              <Table>
                <TableHeader><TableRow><TableHead>Менеджер</TableHead>{monthKeys.map((k) => <TableHead key={k} className="text-right">{MONTHS[Number(k.slice(5, 7)) - 1]}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {managers.map(([id, name]) => (
                    <TableRow key={id}>
                      <TableCell className="whitespace-nowrap">{name}</TableCell>
                      {monthKeys.map((k) => {
                        const c = factCell(id, k);
                        return (
                          <TableCell key={k} className="p-1 text-right">
                            {isDirector
                              ? <Input aria-label={`План ${name}, ${k.slice(0, 7)}`} className="h-8 w-24 text-right" inputMode="decimal" defaultValue={c?.plan || ''} onBlur={(e) => Number(e.target.value || 0) !== (c?.plan ?? 0) && savePlan(id, k, e.target.value)} />
                              : <span className="text-sm">{fmtMoney(c?.plan ?? 0)}</span>}
                            <div className={`text-xs ${c && c.plan && c.fact < c.plan ? 'text-destructive' : 'text-muted-foreground'}`}>факт {fmtMoney(c?.fact ?? 0)}</div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!managers.length && <p className="text-sm text-muted-foreground">Менеджеров продаж нет.</p>}
            </CardContent></Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader><DialogTitle>Новая сделка</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div><Label htmlFor="n-title">Название</Label><Input id="n-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Например, грузчики на склад" /></div>
            <div><Label htmlFor="n-company">Компания</Label><Input id="n-company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="n-name">Контакт</Label><Input id="n-name" value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></div>
              <div><Label htmlFor="n-phone">Телефон</Label><Input id="n-phone" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} /></div>
            </div>
            <div><Label htmlFor="n-email">Почта</Label><Input id="n-email" type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="n-rev">Выручка в месяц, ₽</Label><Input id="n-rev" inputMode="decimal" value={form.expected_revenue} onChange={(e) => setForm({ ...form, expected_revenue: e.target.value })} /></div>
              <div><Label htmlFor="n-mar">Маржа в месяц, ₽</Label><Input id="n-mar" inputMode="decimal" value={form.expected_margin} onChange={(e) => setForm({ ...form, expected_margin: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreating(false)}>Отмена</Button><Button onClick={create}>Создать</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Deals;
