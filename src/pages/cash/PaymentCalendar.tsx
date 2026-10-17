import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { db, rpc } from '@/lib/db';
import { downloadCsv } from '@/lib/csv';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import PageMeta from '@/components/PageMeta';
import { AlertTriangle, Download } from 'lucide-react';

interface Day {
  day: string; balance_open: number; in_invoices: number; in_plan: number; in_manual: number; out_registries: number; out_accrued: number;
  out_plan: number; out_manual: number; balance_close: number; gap: boolean;
}
interface Item { id: string; item_date: string; direction: 'in' | 'out'; amount: number; title: string }

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const inSum = (d: Day) => Number(d.in_invoices) + Number(d.in_plan) + Number(d.in_manual);
const outSum = (d: Day) => Number(d.out_registries) + Number(d.out_accrued) + Number(d.out_plan) + Number(d.out_manual);

// Ф-5: платёжный календарь на четыре недели. Красным подсвечены дни, когда денег не хватает.
const PaymentCalendar: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const [days, setDays] = useState<Day[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [horizon, setHorizon] = useState('28');
  const [f, setF] = useState({ date: today(), direction: 'out', amount: '', title: '' });

  const load = useCallback(async () => {
    if (!orgId) return;
    const [c, p] = await Promise.all([
      rpc('payment_calendar', { _org_id: orgId, _from: today(), _days: Number(horizon) }),
      db('planned_cash_items').select('*').eq('org_id', orgId).gte('item_date', today()).order('item_date'),
    ]);
    if (c.error) { toast({ title: 'Не удалось построить календарь', description: c.error.message, variant: 'destructive' }); return; }
    setDays(c.data ?? []); setItems(p.data ?? []);
  }, [orgId, horizon, toast]);

  useEffect(() => { load(); }, [load]);

  const gapDays = days.filter((d) => d.gap);
  const worst = days.reduce((m, d) => (Number(d.balance_close) < m ? Number(d.balance_close) : m), Infinity);
  const weeks = useMemo(() => {
    const out: { from: string; to: string; inn: number; out: number; close: number }[] = [];
    for (let i = 0; i < days.length; i += 7) {
      const chunk = days.slice(i, i + 7);
      out.push({ from: chunk[0].day, to: chunk[chunk.length - 1].day, inn: chunk.reduce((s, d) => s + inSum(d), 0), out: chunk.reduce((s, d) => s + outSum(d), 0), close: Number(chunk[chunk.length - 1].balance_close) });
    }
    return out;
  }, [days]);

  const add = async () => {
    if (!orgId) return;
    const { error } = await db('planned_cash_items').insert({ org_id: orgId, item_date: f.date, direction: f.direction, amount: Number(f.amount.replace(',', '.')), title: f.title });
    if (error) { toast({ title: 'Не сохранено', description: error.message, variant: 'destructive' }); return; }
    setF({ ...f, amount: '', title: '' });
    load();
  };

  const remove = async (i: Item) => { await db('planned_cash_items').delete().eq('id', i.id); load(); };

  const exportCsv = () => downloadCsv(`kalendar-${today()}.csv`,
    ['Дата', 'Остаток на начало', 'Поступления по счетам', 'Поступления по плану', 'Прочие поступления', 'Реестры в работе', 'К выплате', 'Выплаты по плану смен', 'Прочие расходы', 'Остаток на конец'],
    days.map((d) => [d.day, Number(d.balance_open), Number(d.in_invoices), Number(d.in_plan), Number(d.in_manual), Number(d.out_registries), Number(d.out_accrued), Number(d.out_plan), Number(d.out_manual), Number(d.balance_close)]));

  return (
    <AppLayout>
      <PageMeta title="Платёжный календарь" description="Прогноз денег на четыре недели" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Платёжный календарь</h1>
            <p className="text-muted-foreground">Поступления — по срокам оплаты счетов и по плану выставления; выплаты — реестры, начисленное и запланированные смены. <Link to="/cash" className="underline">К операциям</Link></p>
          </div>
          <div className="flex gap-2">
            <Select value={horizon} onValueChange={setHorizon}>
              <SelectTrigger className="w-36" aria-label="Горизонт"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="14">2 недели</SelectItem><SelectItem value="28">4 недели</SelectItem><SelectItem value="56">8 недель</SelectItem></SelectContent>
            </Select>
            <Button variant="outline" className="gap-2" onClick={exportCsv} disabled={!days.length}><Download className="w-4 h-4" /> CSV</Button>
          </div>
        </div>

        {gapDays.length > 0 ? (
          <Card className="border-destructive">
            <CardContent className="pt-6 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
              <div>
                <div className="font-semibold">Кассовый разрыв: с {fmtDate(gapDays[0].day)} по {fmtDate(gapDays[gapDays.length - 1].day)}</div>
                <p className="text-sm text-muted-foreground">Самый глубокий минус — {fmtMoney(worst)}. Нужно пополнить счёт или ускорить оплату счетов заказчиков.</p>
              </div>
            </CardContent>
          </Card>
        ) : days.length > 0 && <p className="text-sm text-muted-foreground">Разрыва в этом горизонте нет. Минимальный остаток — {fmtMoney(worst)}.</p>}

        <Card><CardHeader><CardTitle className="text-base">По неделям</CardTitle></CardHeader><CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Неделя</TableHead><TableHead className="text-right">Поступления</TableHead><TableHead className="text-right">Выплаты и расходы</TableHead><TableHead className="text-right">Остаток на конец</TableHead></TableRow></TableHeader>
            <TableBody>
              {weeks.map((w) => (
                <TableRow key={w.from}><TableCell>{fmtDate(w.from)} — {fmtDate(w.to)}</TableCell><TableCell className="text-right">{fmtMoney(w.inn)}</TableCell><TableCell className="text-right text-destructive">{fmtMoney(w.out)}</TableCell>
                  <TableCell className={`text-right font-medium ${w.close < 0 ? 'text-destructive' : ''}`}>{fmtMoney(w.close)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>

        <Card><CardHeader><CardTitle className="text-base">По дням</CardTitle></CardHeader><CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>День</TableHead><TableHead className="text-right">Поступления</TableHead><TableHead className="text-right">Выплаты и расходы</TableHead><TableHead className="text-right">Остаток на конец</TableHead></TableRow></TableHeader>
            <TableBody>
              {days.filter((d) => inSum(d) || outSum(d) || d.gap).map((d) => (
                <TableRow key={d.day} className={d.gap ? 'bg-destructive/10' : ''}>
                  <TableCell>{WD[new Date(`${d.day}T00:00:00`).getDay()]} {fmtDate(d.day)} {d.gap && <Badge variant="destructive" className="ml-1">разрыв</Badge>}</TableCell>
                  <TableCell className="text-right text-sm">{inSum(d) ? fmtMoney(inSum(d)) : '—'}{Number(d.in_plan) > 0 && <div className="text-xs text-muted-foreground">из них по плану {fmtMoney(d.in_plan)}</div>}</TableCell>
                  <TableCell className="text-right text-sm">{outSum(d) ? fmtMoney(outSum(d)) : '—'}{Number(d.out_plan) > 0 && <div className="text-xs text-muted-foreground">из них по плану смен {fmtMoney(d.out_plan)}</div>}</TableCell>
                  <TableCell className={`text-right font-medium ${Number(d.balance_close) < 0 ? 'text-destructive' : ''}`}>{fmtMoney(d.balance_close)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter><TableRow><TableCell colSpan={4} className="text-xs text-muted-foreground">Показаны дни с движением и дни разрыва.</TableCell></TableRow></TableFooter>
          </Table>
        </CardContent></Card>

        <Card><CardHeader><CardTitle className="text-base">Плановые статьи</CardTitle><CardDescription>То, чего нет в данных: налоги, аренда, зарплата штата.</CardDescription></CardHeader><CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[150px_130px_130px_1fr_auto] items-end">
            <div><Label htmlFor="pi-date">Дата</Label><Input id="pi-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
            <Select value={f.direction} onValueChange={(v) => setF({ ...f, direction: v })}><SelectTrigger aria-label="Тип"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="out">Расход</SelectItem><SelectItem value="in">Поступление</SelectItem></SelectContent></Select>
            <div><Label htmlFor="pi-sum">Сумма</Label><Input id="pi-sum" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
            <div><Label htmlFor="pi-title">Название</Label><Input id="pi-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
            <Button disabled={!f.amount || !f.title.trim()} onClick={add}>Добавить</Button>
          </div>
          {items.map((i) => (
            <div key={i.id} className="flex items-center justify-between text-sm"><span>{fmtDate(i.item_date)} · {i.title}</span>
              <span className="flex items-center gap-3"><span className={i.direction === 'out' ? 'text-destructive' : ''}>{i.direction === 'out' ? '−' : '+'}{fmtMoney(i.amount)}</span><Button size="sm" variant="ghost" onClick={() => remove(i)}>Удалить</Button></span></div>
          ))}
        </CardContent></Card>
      </div>
    </AppLayout>
  );
};

export default PaymentCalendar;
