import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { usePermissions } from '@/hooks/usePermissions';
import { db } from '@/lib/db';
import { addDays, fmtDate, today } from '@/lib/format';
import { fmtTime } from '@/lib/ordersMeta';
import { COLOR_CLASSES, mondayOf, staffingColor, type StaffingRow } from '@/lib/planningMeta';
import { ShiftPanel } from '@/components/planning/ShiftPanel';
import PageMeta from '@/components/PageMeta';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Option { id: string; name: string }
interface SiteOption extends Option { timezone: string; client_id: string | null }

const ALL = 'all';
const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const SPAN_OPTIONS: Record<string, number> = { '7': 7, '14': 14, '28': 28 };

// Сетка планирования (О-7): строки — объект → позиция → время смены, столбцы — дни.
const PlanningGrid: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const { can, loading: permsLoading } = usePermissions();
  const [from, setFrom] = useState(mondayOf(today()));
  const [span, setSpan] = useState('7');
  const [client, setClient] = useState(ALL);
  const [site, setSite] = useState(ALL);
  const [position, setPosition] = useState(ALL);
  const [rows, setRows] = useState<StaffingRow[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [clients, setClients] = useState<Option[]>([]);
  const [positions, setPositions] = useState<Option[]>([]);
  const [selected, setSelected] = useState<StaffingRow | null>(null);
  const [loading, setLoading] = useState(true);

  const days = Number(span);
  const to = addDays(from, days - 1);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    let q = db('shift_staffing').select('*').eq('org_id', orgId).gte('shift_date', from).lte('shift_date', to).order('start_at').limit(5000);
    if (client !== ALL) q = q.eq('client_id', client);
    if (site !== ALL) q = q.eq('site_id', site);
    if (position !== ALL) q = q.eq('position_id', position);
    const [s, st, c, p] = await Promise.all([
      q,
      db('sites').select('id,name,timezone,client_id').eq('org_id', orgId).order('name'),
      db('clients').select('id,name').eq('org_id', orgId).order('name'),
      db('positions').select('id,name').eq('org_id', orgId).order('sort_order'),
    ]);
    setLoading(false);
    if (s.error) { toast({ title: 'Не удалось загрузить сетку', description: s.error.message, variant: 'destructive' }); return; }
    setRows(s.data ?? []); setSites(st.data ?? []); setClients(c.data ?? []); setPositions(p.data ?? []);
  }, [orgId, from, to, client, site, position, toast]);

  useEffect(() => { load(); }, [load]);

  const tzOf = (siteId: string) => sites.find((x) => x.id === siteId)?.timezone ?? 'Asia/Yekaterinburg';
  const nameOf = (list: Option[], id: string) => list.find((x) => x.id === id)?.name ?? '—';

  const dates = useMemo(() => Array.from({ length: days }, (_, i) => addDays(from, i)), [from, days]);

  // Строка = объект + позиция + время смены (по часовому поясу объекта).
  const grid = useMemo(() => {
    const map = new Map<string, { key: string; siteId: string; positionId: string; slot: string; cells: Map<string, StaffingRow[]> }>();
    for (const r of rows) {
      const slot = `${fmtTime(r.start_at, tzOf(r.site_id))}–${fmtTime(r.end_at, tzOf(r.site_id))}`;
      const key = `${r.site_id}|${r.position_id}|${slot}`;
      if (!map.has(key)) map.set(key, { key, siteId: r.site_id, positionId: r.position_id, slot, cells: new Map() });
      const row = map.get(key)!;
      row.cells.set(r.shift_date, [...(row.cells.get(r.shift_date) ?? []), r]);
    }
    return Array.from(map.values()).sort((a, b) => nameOf(sites, a.siteId).localeCompare(nameOf(sites, b.siteId), 'ru')
      || nameOf(positions, a.positionId).localeCompare(nameOf(positions, b.positionId), 'ru') || a.slot.localeCompare(b.slot));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sites, positions]);

  const totals = useMemo(() => rows.filter((r) => r.status !== 'cancelled').reduce((acc, r) => ({
    needed: acc.needed + r.headcount, assigned: acc.assigned + r.assigned_count, confirmed: acc.confirmed + r.confirmed_count,
  }), { needed: 0, assigned: 0, confirmed: 0 }), [rows]);

  const canManage = can('assignments', 'create');
  const shiftTitle = selected ? `${nameOf(sites, selected.site_id)} — ${nameOf(positions, selected.position_id)}` : '';

  return (
    <AppLayout>
      <PageMeta title="Планирование" description="Сетка смен и назначение исполнителей" />
      <div className="max-w-7xl mx-auto space-y-4 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Планирование</h1>
          <p className="text-muted-foreground">Строки — объект, позиция и время смены; в ячейке «назначено / нужно». Красный — не хватает людей, жёлтый — есть неподтвердившие, зелёный — укомплектовано.</p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" aria-label="Назад" onClick={() => setFrom(addDays(from, -days))}><ChevronLeft className="w-4 h-4" /></Button>
                <Button variant="outline" onClick={() => setFrom(mondayOf(today()))}>Сегодня</Button>
                <Button variant="outline" size="icon" aria-label="Вперёд" onClick={() => setFrom(addDays(from, days))}><ChevronRight className="w-4 h-4" /></Button>
              </div>
              <span className="text-sm font-medium">{fmtDate(from)} — {fmtDate(to)}</span>
              <Select value={span} onValueChange={setSpan}>
                <SelectTrigger className="w-36" aria-label="Период"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.keys(SPAN_OPTIONS).map((k) => <SelectItem key={k} value={k}>{k === '7' ? 'Неделя' : k === '14' ? '2 недели' : 'Месяц'}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={client} onValueChange={(v) => { setClient(v); setSite(ALL); }}>
                <SelectTrigger className="w-48" aria-label="Заказчик"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={ALL}>Все заказчики</SelectItem>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={site} onValueChange={setSite}>
                <SelectTrigger className="w-48" aria-label="Объект"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={ALL}>Все объекты</SelectItem>{sites.filter((s) => client === ALL || s.client_id === client).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={position} onValueChange={setPosition}>
                <SelectTrigger className="w-48" aria-label="Позиция"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={ALL}>Все позиции</SelectItem>{positions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
              <div className="ml-auto flex gap-2 text-sm">
                <Badge variant="outline">нужно {totals.needed}</Badge>
                <Badge variant="outline">назначено {totals.assigned}</Badge>
                <Badge variant="outline">подтвердили {totals.confirmed}</Badge>
              </div>
            </div>

            {permsLoading || loading ? <p className="text-muted-foreground">Загрузка…</p> : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="text-left p-2 min-w-56 sticky left-0 bg-background">Объект · позиция · время</th>
                      {dates.map((d, i) => (
                        <th key={d} className={`p-2 text-center min-w-20 ${d === today() ? 'text-primary' : ''}`}>
                          <div>{DAY_NAMES[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7]}</div>
                          <div className="text-xs font-normal">{d.slice(8)}.{d.slice(5, 7)}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.map((row) => (
                      <tr key={row.key} className="border-t">
                        <td className="p-2 sticky left-0 bg-background">
                          <div className="font-medium">{nameOf(sites, row.siteId)}</div>
                          <div className="text-xs text-muted-foreground">{nameOf(positions, row.positionId)} · {row.slot}</div>
                        </td>
                        {dates.map((d) => (
                          <td key={d} className="p-1 text-center">
                            {(row.cells.get(d) ?? []).map((cell) => (
                              <button
                                key={cell.shift_id}
                                type="button"
                                onClick={() => setSelected(cell)}
                                className={`w-full rounded border px-2 py-1 text-xs font-medium ${COLOR_CLASSES[staffingColor(cell)]}`}
                                aria-label={`${fmtDate(d)}: назначено ${cell.assigned_count} из ${cell.headcount}`}
                              >
                                {cell.assigned_count}/{cell.headcount}
                                {cell.responses_count > 0 && <span className="ml-1" title="Есть отклики">●</span>}
                                {!cell.published_at && cell.status !== 'cancelled' && <span className="ml-1" title="Ждёт запуска объекта">⏸</span>}
                              </button>
                            ))}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {!grid.length && <tr><td colSpan={days + 1} className="p-4 text-muted-foreground">В этом периоде смен нет.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ShiftPanel shift={selected} tz={selected ? tzOf(selected.site_id) : 'Asia/Yekaterinburg'} title={shiftTitle}
        canManage={canManage} onClose={() => setSelected(null)} onChanged={load} />
    </AppLayout>
  );
};

export default PlanningGrid;
