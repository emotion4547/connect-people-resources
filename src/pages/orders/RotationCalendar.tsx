import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useOrg } from '@/contexts/OrgContext';
import { useToast } from '@/hooks/use-toast';
import { rpc } from '@/lib/db';
import { downloadExcel } from '@/lib/csv';
import { addDays, fmtDate, today } from '@/lib/format';
import { mondayOf } from '@/lib/planningMeta';
import PageMeta from '@/components/PageMeta';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';

interface Cal { order_id: string; site_name: string; client_name: string; housing_address: string | null; worker_id: string; worker_name: string; arrival_date: string; departure_date: string }
interface Load { order_id: string; housing_address: string | null; site_name: string; day: string; beds: number; occupied: number; free: number }

const DAYS = 28;
const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// ВХ-2: календарь вахт — исполнитель × дни, заезды и выезды недели, свободные места в проживании.
const RotationCalendar: React.FC = () => {
  const { orgId } = useOrg();
  const { toast } = useToast();
  const [from, setFrom] = useState(mondayOf(today()));
  const [rows, setRows] = useState<Cal[]>([]);
  const [load, setLoad] = useState<Load[]>([]);

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    const [c, l] = await Promise.all([rpc('rotation_calendar', { _org_id: orgId, _from: from, _days: DAYS }), rpc('rotation_housing_load', { _org_id: orgId, _from: from, _days: DAYS })]);
    if (c.error) { toast({ title: 'Не удалось загрузить календарь', description: c.error.message, variant: 'destructive' }); return; }
    setRows((c.data ?? []) as Cal[]); setLoad(((l.data ?? []) as Load[]).map((x) => ({ ...x, beds: Number(x.beds), occupied: Number(x.occupied), free: Number(x.free) })));
  }, [orgId, from, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const dates = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(from, i)), [from]);
  const weekEnd = addDays(mondayOf(today()), 6);
  const arrivals = rows.filter((r) => r.arrival_date >= mondayOf(today()) && r.arrival_date <= weekEnd);
  const departures = rows.filter((r) => r.departure_date >= mondayOf(today()) && r.departure_date <= weekEnd);
  const housing = Array.from(new Map(load.map((l) => [l.order_id, l])).values());
  const loadOf = (orderId: string, d: string) => load.find((l) => l.order_id === orderId && l.day === d);

  const exportCsv = () => downloadExcel(`rotations-${from}.xlsx`, ['Заказчик', 'Объект', 'Исполнитель', 'Заезд', 'Выезд', 'Жильё'], rows.map((r) => [r.client_name, r.site_name, r.worker_name, fmtDate(r.arrival_date), fmtDate(r.departure_date), r.housing_address]));

  return (
    <AppLayout>
      <PageMeta title="Календарь вахт" description="Кто где на вахте, заезды и выезды, свободные места" />
      <div className="max-w-7xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold mb-2">Календарь вахт</h1>
            <p className="text-muted-foreground">Строки — исполнители на вахте, столбцы — дни. Условия вахты задаются в карточке заказа.</p>
          </div>
          <Button variant="outline" className="gap-2" onClick={exportCsv} disabled={!rows.length}><Download className="w-4 h-4" /> Excel</Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card><CardHeader><CardTitle className="text-lg">Заезды на этой неделе</CardTitle></CardHeader><CardContent className="text-sm space-y-1">
            {arrivals.map((r) => <div key={`${r.order_id}${r.worker_id}`}>{fmtDate(r.arrival_date)} · <Link className="hover:underline" to={`/orders/${r.order_id}`}>{r.worker_name}</Link> · {r.site_name}</div>)}
            {!arrivals.length && <p className="text-muted-foreground">Заездов нет.</p>}
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-lg">Выезды на этой неделе</CardTitle></CardHeader><CardContent className="text-sm space-y-1">
            {departures.map((r) => <div key={`${r.order_id}${r.worker_id}`}>{fmtDate(r.departure_date)} · <Link className="hover:underline" to={`/orders/${r.order_id}`}>{r.worker_name}</Link> · {r.site_name}</div>)}
            {!departures.length && <p className="text-muted-foreground">Выездов нет.</p>}
          </CardContent></Card>
        </div>

        <Card><CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" aria-label="Назад" onClick={() => setFrom(addDays(from, -7))}><ChevronLeft className="w-4 h-4" /></Button>
            <Button variant="outline" onClick={() => setFrom(mondayOf(today()))}>Сегодня</Button>
            <Button variant="outline" size="icon" aria-label="Вперёд" onClick={() => setFrom(addDays(from, 7))}><ChevronRight className="w-4 h-4" /></Button>
            <span className="text-sm font-medium">{fmtDate(from)} — {fmtDate(addDays(from, DAYS - 1))}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="border-collapse text-xs">
              <thead><tr><th className="text-left p-2 min-w-52 sticky left-0 bg-background">Исполнитель</th>
                {dates.map((d) => <th key={d} className={`p-1 min-w-9 text-center ${d === today() ? 'text-primary' : ''}`}><div>{DAY_NAMES[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]}</div><div className="font-normal">{d.slice(8)}</div></th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.order_id}${r.worker_id}`} className="border-t">
                    <td className="p-2 sticky left-0 bg-background"><Link className="hover:underline font-medium" to={`/orders/${r.order_id}`}>{r.worker_name}</Link><div className="text-muted-foreground">{r.site_name}</div></td>
                    {dates.map((d) => {
                      const inside = d >= r.arrival_date && d <= r.departure_date;
                      return <td key={d} className={`p-0 h-8 text-center ${inside ? 'bg-primary/20' : ''}`} title={inside ? `${fmtDate(r.arrival_date)} — ${fmtDate(r.departure_date)}` : undefined}>
                        {d === r.arrival_date ? '→' : d === r.departure_date ? '←' : ''}</td>;
                    })}
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={DAYS + 1} className="p-4 text-muted-foreground">В этом периоде вахт нет.</td></tr>}
              </tbody>
            </table>
          </div>
        </CardContent></Card>

        {housing.length > 0 && (
          <Card><CardHeader><CardTitle className="text-lg">Проживание: свободные места</CardTitle></CardHeader><CardContent className="overflow-x-auto">
            <table className="border-collapse text-xs">
              <thead><tr><th className="text-left p-2 min-w-52">Жильё</th>{dates.map((d) => <th key={d} className="p-1 min-w-9 text-center font-normal">{d.slice(8)}</th>)}</tr></thead>
              <tbody>{housing.map((h) => (
                <tr key={h.order_id} className="border-t">
                  <td className="p-2"><div className="font-medium">{h.housing_address ?? h.site_name}</div><div className="text-muted-foreground">мест {h.beds}</div></td>
                  {dates.map((d) => { const l = loadOf(h.order_id, d); return <td key={d} className={`text-center ${l && l.free < 0 ? 'bg-red-100 text-red-700 font-semibold' : l && l.free === 0 ? 'bg-amber-100' : ''}`}>{l ? l.free : ''}</td>; })}
                </tr>
              ))}</tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2"><Badge variant="outline">красное</Badge> — мест не хватает, <Badge variant="outline">жёлтое</Badge> — всё занято.</p>
          </CardContent></Card>
        )}
      </div>
    </AppLayout>
  );
};

export default RotationCalendar;
