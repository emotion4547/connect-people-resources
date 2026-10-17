import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/db';
import { today } from '@/lib/format';
import { UNITS } from '@/lib/clientsMeta';
import { WEEKDAYS, hhmm, type Order } from '@/lib/ordersMeta';

interface Option { id: string; name: string }
interface SiteOption extends Option { client_id: string | null }

export interface OrderFormValue {
  client_id: string; site_id: string; position_id: string; unit: string; mode: 'range' | 'dates';
  date_from: string; date_to: string; weekdays: number[]; dates: string[];
  start_time: string; end_time: string; break_minutes: string; headcount: string; reserve_count: string;
  requirements: string; comment: string;
}

export const emptyOrderForm = (): OrderFormValue => ({
  client_id: '', site_id: '', position_id: '', unit: 'hour', mode: 'range', date_from: today(), date_to: today(),
  weekdays: [], dates: [], start_time: '08:00', end_time: '17:00', break_minutes: '0', headcount: '1', reserve_count: '0',
  requirements: '', comment: '',
});

export const formFromOrder = (o: Order): OrderFormValue => ({
  client_id: o.client_id, site_id: o.site_id, position_id: o.position_id, unit: o.unit,
  mode: o.dates && o.dates.length ? 'dates' : 'range', date_from: o.date_from, date_to: o.date_to,
  weekdays: o.weekdays ?? [], dates: o.dates ?? [], start_time: hhmm(o.start_time), end_time: hhmm(o.end_time),
  break_minutes: String(o.break_minutes), headcount: String(o.headcount), reserve_count: String(o.reserve_count),
  requirements: o.requirements ?? '', comment: o.comment ?? '',
});

// Поля, которые можно править после создания: клиент, объект и позиция меняются только новым заказом.
export const orderPayload = (f: OrderFormValue) => ({
  date_from: f.date_from, date_to: f.date_to,
  weekdays: f.mode === 'range' && f.weekdays.length ? f.weekdays : null,
  dates: f.mode === 'dates' ? f.dates : null,
  start_time: f.start_time, end_time: f.end_time, break_minutes: Number(f.break_minutes) || 0,
  headcount: Number(f.headcount) || 1, reserve_count: Number(f.reserve_count) || 0,
  requirements: f.requirements || null, comment: f.comment || null,
});

interface Props {
  orgId: string; value: OrderFormValue; onChange: (v: OrderFormValue) => void; lockedKeys?: boolean;
}

export const OrderForm: React.FC<Props> = ({ orgId, value, onChange, lockedKeys }) => {
  const { toast } = useToast();
  const [clients, setClients] = useState<Option[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [positions, setPositions] = useState<Option[]>([]);
  const [newDate, setNewDate] = useState('');

  useEffect(() => {
    (async () => {
      const [c, s, p] = await Promise.all([
        db('clients').select('id,name').eq('org_id', orgId).not('status', 'in', '(archived,paused)').order('name'),
        db('sites').select('id,name,client_id').eq('org_id', orgId).order('name'),
        db('positions').select('id,name').eq('org_id', orgId).eq('is_active', true).order('sort_order'),
      ]);
      if (c.error || s.error || p.error) toast({ title: 'Не удалось загрузить справочники', description: (c.error ?? s.error ?? p.error).message, variant: 'destructive' });
      setClients(c.data ?? []); setSites(s.data ?? []); setPositions(p.data ?? []);
    })();
  }, [orgId, toast]);

  const clientSites = useMemo(() => sites.filter((s) => s.client_id === value.client_id), [sites, value.client_id]);
  const set = (patch: Partial<OrderFormValue>) => onChange({ ...value, ...patch });
  const toggleDay = (id: number, on: boolean) => set({ weekdays: on ? [...value.weekdays, id].sort() : value.weekdays.filter((d) => d !== id) });
  const addDate = () => { if (newDate && !value.dates.includes(newDate)) set({ dates: [...value.dates, newDate].sort() }); setNewDate(''); };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>Заказчик</Label>
          <Select value={value.client_id} onValueChange={(v) => set({ client_id: v, site_id: '' })} disabled={lockedKeys}>
            <SelectTrigger><SelectValue placeholder="Выберите" /></SelectTrigger>
            <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Объект</Label>
          <Select value={value.site_id} onValueChange={(v) => set({ site_id: v })} disabled={lockedKeys || !value.client_id}>
            <SelectTrigger><SelectValue placeholder="Выберите" /></SelectTrigger>
            <SelectContent>{clientSites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Позиция</Label>
          <Select value={value.position_id} onValueChange={(v) => set({ position_id: v })} disabled={lockedKeys}>
            <SelectTrigger><SelectValue placeholder="Выберите" /></SelectTrigger>
            <SelectContent>{positions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>Единица оплаты</Label>
          <Select value={value.unit} onValueChange={(v) => set({ unit: v })} disabled={lockedKeys}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(UNITS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>График</Label>
          <Select value={value.mode} onValueChange={(v) => set({ mode: v as 'range' | 'dates' })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="range">Период и дни недели</SelectItem>
              <SelectItem value="dates">Список дат</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {value.mode === 'range' ? (
        <div className="space-y-3">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2"><Label htmlFor="o-from">С</Label><Input id="o-from" type="date" value={value.date_from} onChange={(e) => set({ date_from: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="o-to">По</Label><Input id="o-to" type="date" value={value.date_to} onChange={(e) => set({ date_to: e.target.value })} /></div>
          </div>
          <div className="flex flex-wrap gap-4">
            {WEEKDAYS.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={value.weekdays.includes(d.id)} onCheckedChange={(on) => toggleDay(d.id, on === true)} />{d.short}
              </label>
            ))}
            <span className="text-xs text-muted-foreground">Дни не выбраны — каждый день периода</span>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} aria-label="Добавить дату" />
            <Button type="button" variant="outline" onClick={addDate} disabled={!newDate}>Добавить дату</Button>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {value.dates.map((d) => (
              <Button key={d} type="button" variant="secondary" size="sm" onClick={() => set({ dates: value.dates.filter((x) => x !== d) })}>
                {d.split('-').reverse().join('.')} ×
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-5">
        <div className="space-y-2"><Label htmlFor="o-start">Начало</Label><Input id="o-start" type="time" value={value.start_time} onChange={(e) => set({ start_time: e.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="o-end">Конец</Label><Input id="o-end" type="time" value={value.end_time} onChange={(e) => set({ end_time: e.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="o-break">Перерыв, мин</Label><Input id="o-break" inputMode="numeric" value={value.break_minutes} onChange={(e) => set({ break_minutes: e.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="o-count">Людей</Label><Input id="o-count" inputMode="numeric" value={value.headcount} onChange={(e) => set({ headcount: e.target.value })} /></div>
        <div className="space-y-2"><Label htmlFor="o-reserve">Резерв</Label><Input id="o-reserve" inputMode="numeric" value={value.reserve_count} onChange={(e) => set({ reserve_count: e.target.value })} /></div>
      </div>
      {value.end_time <= value.start_time && value.end_time !== value.start_time && (
        <p className="text-xs text-muted-foreground">Конец раньше начала: смена пройдёт через полночь, это одна смена.</p>
      )}

      <div className="space-y-2"><Label htmlFor="o-req">Требования</Label><Textarea id="o-req" rows={2} value={value.requirements} onChange={(e) => set({ requirements: e.target.value })} /></div>
      <div className="space-y-2"><Label htmlFor="o-comment">Комментарий</Label><Textarea id="o-comment" rows={2} value={value.comment} onChange={(e) => set({ comment: e.target.value })} /></div>
    </div>
  );
};
