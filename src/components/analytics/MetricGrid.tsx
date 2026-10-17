import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { rpc } from '@/lib/db';
import { downloadCsv } from '@/lib/csv';
import { fmtDate, fmtMoney } from '@/lib/format';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';

export interface Metric { metric: string; name: string; unit: string; value: number | null; prev_value: number | null; delta: number | null; sort_order: number }
interface RecordRow { record_id: string; kind: string; label: string; detail: string; record_date: string; amount: number; link: string | null }

// Метрики, у которых меньше — лучше: рост подсвечивается как ухудшение.
const LOWER_IS_BETTER = new Set(['no_show', 'order_close_hours', 'time_to_admit_days', 'worker_costs', 'overdue_receivables', 'receivables_total']);

export const fmtMetric = (v: number | null | undefined, unit: string) => {
  if (v === null || v === undefined) return '—';
  if (unit === '₽') return fmtMoney(v);
  if (unit === '%') return `${v}%`;
  return `${Number(v).toLocaleString('ru-RU')} ${unit}`;
};

const periodLength = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000) + 1;

interface Props { orgIds: string[]; from: string; to: string; clientId?: string | null; only?: string[]; refreshKey?: number }

// Ан-1: карточки показателей с прошлым периодом; клик по числу открывает записи, из которых оно сложилось.
export const MetricGrid: React.FC<Props> = ({ orgIds, from, to, clientId = null, only, refreshKey = 0 }) => {
  const { toast } = useToast();
  const [metrics, setMetrics] = useState<Metric[] | null>(null);
  const [open, setOpen] = useState<Metric | null>(null);
  const [records, setRecords] = useState<RecordRow[]>([]);

  const load = useCallback(async () => {
    if (!orgIds.length) return;
    const { data, error } = await rpc('analytics_compare', { _org_ids: orgIds, _from: from, _to: to, _client_id: clientId });
    if (error) { toast({ title: 'Не удалось получить показатели', description: error.message, variant: 'destructive' }); setMetrics([]); return; }
    setMetrics(((data ?? []) as Metric[]).map((m) => ({ ...m, value: m.value === null ? null : Number(m.value), prev_value: m.prev_value === null ? null : Number(m.prev_value), delta: m.delta === null ? null : Number(m.delta) })));
  }, [orgIds, from, to, clientId, toast]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const show = async (m: Metric) => {
    setOpen(m); setRecords([]);
    const { data, error } = await rpc('analytics_records', { _org_ids: orgIds, _metric: m.metric, _from: from, _to: to, _client_id: clientId });
    if (error) { toast({ title: 'Не удалось получить записи', description: error.message, variant: 'destructive' }); return; }
    setRecords(((data ?? []) as RecordRow[]).map((r) => ({ ...r, amount: Number(r.amount) })));
  };

  const list = (metrics ?? []).filter((m) => !only || only.includes(m.metric));
  if (!metrics) return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>;
  if (!list.length) return <p className="text-sm text-muted-foreground">Для этого раздела показателей нет или у вас нет доступа к ним.</p>;

  const days = periodLength(from, to);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {list.map((m) => {
          const worse = m.delta !== null && m.delta !== 0 && (LOWER_IS_BETTER.has(m.metric) ? m.delta > 0 : m.delta < 0);
          return (
            <Card key={m.metric}>
              <CardContent className="pt-5">
                <p className="text-sm text-muted-foreground">{m.name}</p>
                <button type="button" onClick={() => show(m)} className="text-2xl font-bold mt-1 hover:underline text-left" aria-label={`${m.name}: показать записи`}>
                  {fmtMetric(m.value, m.unit)}
                </button>
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                  {m.delta !== null && m.delta !== 0 && (m.delta > 0 ? <ArrowUp className={`w-3 h-3 ${worse ? 'text-destructive' : 'text-green-600'}`} /> : <ArrowDown className={`w-3 h-3 ${worse ? 'text-destructive' : 'text-green-600'}`} />)}
                  {m.prev_value === null ? `Прошлые ${days} дн.: нет данных` : `Прошлые ${days} дн.: ${fmtMetric(m.prev_value, m.unit)}`}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{open?.name}: {open ? fmtMetric(open.value, open.unit) : ''}</DialogTitle></DialogHeader>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="gap-2" disabled={!records.length}
              onClick={() => downloadCsv(`${open?.metric}-${from}-${to}.csv`, ['Запись', 'Подробности', 'Дата', 'Значение'], records.map((r) => [r.label, r.detail, fmtDate(r.record_date), r.amount]))}>
              <Download className="w-4 h-4" /> В Excel (CSV)
            </Button>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Запись</TableHead><TableHead>Подробности</TableHead><TableHead>Дата</TableHead><TableHead className="text-right">Значение</TableHead></TableRow></TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={`${r.kind}-${r.record_id}-${r.record_date}`}>
                  <TableCell>{r.link ? <Link className="hover:underline" to={r.link}>{r.label}</Link> : r.label}</TableCell>
                  <TableCell className="text-muted-foreground">{r.detail}</TableCell>
                  <TableCell className="whitespace-nowrap">{fmtDate(r.record_date)}</TableCell>
                  <TableCell className="text-right">{open?.unit === '₽' ? fmtMoney(r.amount) : r.amount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!records.length && <p className="text-sm text-muted-foreground">Записей нет.</p>}
          {records.length >= 500 && <p className="text-xs text-muted-foreground">Показаны первые 500 записей: сузьте период, чтобы увидеть остальные.</p>}
        </DialogContent>
      </Dialog>
    </>
  );
};
