import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { rpc } from '@/lib/db';
import { downloadCsv } from '@/lib/csv';
import { fmtMoney, today } from '@/lib/format';
import PageMeta from '@/components/PageMeta';
import { Download } from 'lucide-react';

interface Row { month: string; article: string; article_name: string; direction: string; bdr_article: string | null; amount_in: number; amount_out: number; entries: number }

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const mlabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

// Ф-4: отчёт ДДС — статьи × месяцы, приход, расход, сальдо, остатки на начало и конец. Клик по сумме открывает операции.
const CashReport: React.FC = () => {
  const { toast } = useToast();
  const { orgId, orgs } = useOrg();
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(today());
  const [scope, setScope] = useState<'one' | 'all'>('one');
  const [rows, setRows] = useState<Row[]>([]);
  const [opening, setOpening] = useState(0);
  const [closing, setClosing] = useState(0);

  const ids = useMemo(() => (scope === 'all' ? orgs.map((o) => o.id) : orgId ? [orgId] : []), [scope, orgs, orgId]);

  const load = useCallback(async () => {
    if (!ids.length) return;
    const before = new Date(`${from}T00:00:00Z`);
    before.setUTCDate(before.getUTCDate() - 1);
    const [r, o, c] = await Promise.all([
      rpc('cashflow_report', { _org_ids: ids, _from: from, _to: to }),
      rpc('cash_total_balance', { _org_ids: ids, _date: before.toISOString().slice(0, 10) }),
      rpc('cash_total_balance', { _org_ids: ids, _date: to }),
    ]);
    if (r.error) { toast({ title: 'Не удалось построить отчёт', description: r.error.message, variant: 'destructive' }); return; }
    setRows(r.data ?? []); setOpening(Number(o.data ?? 0)); setClosing(Number(c.data ?? 0));
  }, [ids, from, to, toast]);

  useEffect(() => { load(); }, [load]);

  const months = Array.from(new Set(rows.map((r) => r.month))).sort();
  const articles = Array.from(new Map(rows.map((r) => [r.article, r])).values());
  const cell = (a: string, m: string, dir: 'in' | 'out') => rows.filter((r) => r.article === a && r.month === m).reduce((s, r) => s + Number(dir === 'in' ? r.amount_in : r.amount_out), 0);
  const total = (m: string, dir: 'in' | 'out') => rows.filter((r) => r.month === m).reduce((s, r) => s + Number(dir === 'in' ? r.amount_in : r.amount_out), 0);
  const monthRange = (m: string) => { const d = new Date(`${m}T00:00:00Z`); const e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); return [m > from ? m : from, e.toISOString().slice(0, 10) < to ? e.toISOString().slice(0, 10) : to]; };
  const link = (a: string, m: string, dir: 'in' | 'out') => { const [f, t] = monthRange(m); return `/cash?from=${f}&to=${t}&direction=${dir}${a === 'unsorted' ? '&category=none' : ''}`; };

  const exportCsv = () => {
    const header = ['Статья', 'Приход/расход', ...months.map(mlabel), 'Итого'];
    const body = articles.flatMap((a) => {
      const inn = months.map((m) => cell(a.article, m, 'in')); const out = months.map((m) => cell(a.article, m, 'out'));
      const r: (string | number)[][] = [];
      if (inn.some((x) => x)) r.push([a.article_name, 'приход', ...inn, inn.reduce((s, x) => s + x, 0)]);
      if (out.some((x) => x)) r.push([a.article_name, 'расход', ...out, out.reduce((s, x) => s + x, 0)]);
      return r;
    });
    body.push(['Сальдо', '', ...months.map((m) => total(m, 'in') - total(m, 'out')), months.reduce((s, m) => s + total(m, 'in') - total(m, 'out'), 0)]);
    downloadCsv(`dds-${from}-${to}.csv`, header, [...body, ['Остаток на начало', '', opening], ['Остаток на конец', '', closing]]);
  };

  return (
    <AppLayout>
      <PageMeta title="Отчёт ДДС" description="Движение денежных средств" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Отчёт ДДС</h1>
            <p className="text-muted-foreground">Статьи × месяцы. Перемещения между своими счетами в отчёт не входят. Нажмите на сумму, чтобы увидеть операции.</p>
          </div>
          <Button variant="outline" className="gap-2" onClick={exportCsv} disabled={!rows.length}><Download className="w-4 h-4" /> В Excel (CSV)</Button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="r-from">С</Label><Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="r-to">По</Label><Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          {orgs.length > 1 && (
            <Select value={scope} onValueChange={(v) => setScope(v as 'one' | 'all')}>
              <SelectTrigger className="w-60" aria-label="Организации"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="one">Текущая организация</SelectItem><SelectItem value="all">Все мои организации (суммарно)</SelectItem></SelectContent>
            </Select>
          )}
          <Button asChild variant="ghost"><Link to="/cash">К операциям</Link></Button>
        </div>
        <Card><CardContent className="pt-6 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Статья</TableHead>{months.map((m) => <TableHead key={m} className="text-right">{mlabel(m)}</TableHead>)}<TableHead className="text-right">Итого</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-muted/40"><TableCell className="font-medium">Остаток на начало</TableCell><TableCell colSpan={months.length} /><TableCell className="text-right font-medium">{fmtMoney(opening)}</TableCell></TableRow>
              {articles.flatMap((a) => (['in', 'out'] as const).map((dir) => {
                const vals = months.map((m) => cell(a.article, m, dir));
                if (!vals.some((v) => v)) return null;
                return (
                  <TableRow key={`${a.article}-${dir}`}>
                    <TableCell>{a.article_name} <span className="text-xs text-muted-foreground">{dir === 'in' ? 'приход' : 'расход'}</span></TableCell>
                    {months.map((m, i) => <TableCell key={m} className={`text-right ${dir === 'out' ? 'text-destructive' : ''}`}>{vals[i] ? <Link className="hover:underline" to={link(a.article, m, dir)}>{fmtMoney(vals[i])}</Link> : '—'}</TableCell>)}
                    <TableCell className="text-right font-medium">{fmtMoney(vals.reduce((s, x) => s + x, 0))}</TableCell>
                  </TableRow>
                );
              }))}
              <TableRow className="font-medium"><TableCell>Сальдо</TableCell>{months.map((m) => <TableCell key={m} className="text-right">{fmtMoney(total(m, 'in') - total(m, 'out'))}</TableCell>)}<TableCell className="text-right">{fmtMoney(months.reduce((s, m) => s + total(m, 'in') - total(m, 'out'), 0))}</TableCell></TableRow>
              <TableRow className="bg-muted/40"><TableCell className="font-medium">Остаток на конец</TableCell><TableCell colSpan={months.length} /><TableCell className="text-right font-medium">{fmtMoney(closing)}</TableCell></TableRow>
            </TableBody>
          </Table>
          {!rows.length && <p className="text-sm text-muted-foreground mt-3">За период операций нет.</p>}
        </CardContent></Card>
      </div>
    </AppLayout>
  );
};

export default CashReport;
