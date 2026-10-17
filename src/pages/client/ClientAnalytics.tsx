import React, { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db, rpc } from '@/lib/db';
import { downloadCsv } from '@/lib/csv';
import { fmtMoney, monthEnd, monthStart } from '@/lib/format';
import PageMeta from '@/components/PageMeta';
import { Download } from 'lucide-react';

interface Row { site_id: string; site_name: string; needed: number; confirmed: number; started_needed: number; on_site: number; hours: number; amount: number; avg_rating: number | null }
interface Client { id: string; name: string }

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '—');

// Кабинет заказчика: укомплектованность и выход, часы и сумма по объектам за период, средняя оценка людей.
const ClientAnalytics: React.FC = () => {
  const { toast } = useToast();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [clients, setClients] = useState<Client[]>([]);
  const [rows, setRows] = useState<Record<string, Row[]>>({});

  useEffect(() => { db('clients').select('id,name').then(({ data }) => setClients((data ?? []) as Client[])); }, []);
  useEffect(() => {
    clients.forEach(async (c) => {
      const { data, error } = await rpc('client_dashboard', { _client_id: c.id, _from: from, _to: to });
      if (error) { toast({ title: 'Не удалось загрузить показатели', description: error.message, variant: 'destructive' }); return; }
      setRows((prev) => ({ ...prev, [c.id]: (data ?? []).map((r: Row) => ({ ...r, needed: Number(r.needed), confirmed: Number(r.confirmed), started_needed: Number(r.started_needed), on_site: Number(r.on_site), hours: Number(r.hours), amount: Number(r.amount), avg_rating: r.avg_rating === null ? null : Number(r.avg_rating) })) }));
    });
  }, [clients, from, to, toast]);

  const all = Object.values(rows).flat();
  const sum = (k: 'needed' | 'confirmed' | 'started_needed' | 'on_site' | 'hours' | 'amount') => all.reduce((s, r) => s + r[k], 0);

  return (
    <DashboardLayout role="hr">
      <PageMeta title="Показатели" description="Укомплектованность, выход, часы и суммы по объектам" />
      <div className="space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Показатели</h1>
          <p className="text-muted-foreground">Как мы выполняем ваши заказы: сколько людей было нужно, сколько вышло, сколько часов отработано и на какую сумму.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="c-from">С</Label><Input id="c-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="c-to">По</Label><Input id="c-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Укомплектованность</p><p className="text-2xl font-bold mt-1">{pct(sum('confirmed'), sum('needed'))}</p></CardContent></Card>
          <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Выход на объект</p><p className="text-2xl font-bold mt-1">{pct(sum('on_site'), sum('started_needed'))}</p></CardContent></Card>
          <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Отработано часов</p><p className="text-2xl font-bold mt-1">{sum('hours')}</p></CardContent></Card>
          <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Сумма за период</p><p className="text-2xl font-bold mt-1">{fmtMoney(sum('amount'))}</p></CardContent></Card>
        </div>
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-lg">По объектам</CardTitle>
            <Button variant="outline" size="sm" className="gap-2" disabled={!all.length}
              onClick={() => downloadCsv(`objects-${from}-${to}.csv`, ['Объект', 'Нужно', 'Подтвердили', 'На месте', 'Часы', 'Сумма', 'Оценка'], all.map((r) => [r.site_name, r.needed, r.confirmed, r.on_site, r.hours, r.amount, r.avg_rating ?? '']))}>
              <Download className="w-4 h-4" /> В Excel (CSV)</Button></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Объект</TableHead><TableHead className="text-right">Нужно</TableHead><TableHead className="text-right">Подтвердили</TableHead><TableHead className="text-right">На месте</TableHead><TableHead className="text-right">Часы</TableHead><TableHead className="text-right">Сумма</TableHead><TableHead className="text-right">Оценка</TableHead></TableRow></TableHeader>
              <TableBody>{all.map((r) => (
                <TableRow key={r.site_id}><TableCell>{r.site_name}</TableCell><TableCell className="text-right">{r.needed}</TableCell><TableCell className="text-right">{r.confirmed}</TableCell><TableCell className="text-right">{r.on_site}</TableCell><TableCell className="text-right">{r.hours}</TableCell><TableCell className="text-right">{fmtMoney(r.amount)}</TableCell><TableCell className="text-right">{r.avg_rating ?? '—'}</TableCell></TableRow>
              ))}</TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default ClientAnalytics;
