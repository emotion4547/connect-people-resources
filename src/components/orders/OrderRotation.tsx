import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db, rpc } from '@/lib/db';
import { addDays, fmtDate } from '@/lib/format';

interface Rotation {
  arrival_date: string; departure_date: string; housing_address: string | null; housing_beds: number; housing_cost_per_bed_day: number; meals: boolean; meals_cost_per_day: number;
  per_diem_worker: number; per_diem_client: number; travel_worker: number; travel_client: number; note: string | null;
}
interface Member { worker_id: string; arrival_date: string; departure_date: string; full_name?: string }

interface Props { orderId: string; dateFrom: string; dateTo: string; closed: boolean; canEdit: boolean; canAccrue: boolean; onChanged: () => void }

const EMPTY = { arrival: '', departure: '', address: '', beds: '0', bedCost: '0', meals: false, mealsCost: '0', perDiemWorker: '0', perDiemClient: '0', travelWorker: '0', travelClient: '0', note: '' };

// ВХ-1, ВХ-3: условия вахты (заезд, выезд, жильё, питание, суточные, проезд), состав и начисление суточных.
export const OrderRotation: React.FC<Props> = ({ orderId, dateFrom, dateTo, closed, canEdit, canAccrue, onChanged }) => {
  const { toast } = useToast();
  const [rotation, setRotation] = useState<Rotation | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState({ ...EMPTY, arrival: addDays(dateFrom, -1), departure: addDays(dateTo, 1) });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r, m] = await Promise.all([db('order_rotations').select('*').eq('order_id', orderId).maybeSingle(), db('rotation_members').select('worker_id,arrival_date,departure_date').eq('order_id', orderId)]);
    const rot = r.data as Rotation | null;
    setRotation(rot);
    const list = (m.data ?? []) as Member[];
    if (list.length) {
      const w = await db('workers').select('user_id,full_name').in('user_id', list.map((x) => x.worker_id));
      const names = new Map<string, string>((w.data ?? []).map((x: { user_id: string; full_name: string }) => [x.user_id, x.full_name]));
      list.forEach((x) => { x.full_name = names.get(x.worker_id) ?? x.worker_id; });
    }
    setMembers(list);
    if (rot) setForm({ arrival: rot.arrival_date, departure: rot.departure_date, address: rot.housing_address ?? '', beds: String(rot.housing_beds), bedCost: String(rot.housing_cost_per_bed_day), meals: rot.meals,
      mealsCost: String(rot.meals_cost_per_day), perDiemWorker: String(rot.per_diem_worker), perDiemClient: String(rot.per_diem_client), travelWorker: String(rot.travel_worker), travelClient: String(rot.travel_client), note: rot.note ?? '' });
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn: string, args: Record<string, unknown>, ok?: string) => {
    setBusy(true);
    const { data, error } = await rpc(fn, args);
    setBusy(false);
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return null; }
    if (ok) toast({ title: ok });
    await load(); onChanged();
    return data;
  };

  const save = async () => {
    const r = await run('set_order_rotation', {
      _order_id: orderId, _arrival: form.arrival, _departure: form.departure, _address: form.address, _beds: Number(form.beds), _bed_cost: Number(form.bedCost), _meals: form.meals, _meals_cost: Number(form.mealsCost),
      _per_diem_worker: Number(form.perDiemWorker), _per_diem_client: Number(form.perDiemClient), _travel_worker: Number(form.travelWorker), _travel_client: Number(form.travelClient), _note: form.note || null,
    }, 'Условия вахты сохранены');
    if (r !== null) setEditing(false);
  };

  const num = (k: keyof typeof EMPTY, label: string, w = 'w-28') => (
    <div><Label htmlFor={`rot-${k}`} className="text-xs">{label}</Label><Input id={`rot-${k}`} className={w} inputMode="decimal" value={String(form[k])} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
  );

  if (!rotation && !editing) {
    return canEdit && !closed ? <Button variant="outline" onClick={() => setEditing(true)}>Оформить как вахту</Button> : null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">Вахта {rotation && <Badge variant="secondary">{fmtDate(rotation.arrival_date)} — {fmtDate(rotation.departure_date)}</Badge>}</CardTitle>
        <CardDescription>Проживание и питание идут в БДР, суточные и проезд начисляются отдельными начислениями. Состав — все назначенные на смены заказа.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {editing || !rotation ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <div><Label htmlFor="rot-arrival" className="text-xs">Заезд</Label><Input id="rot-arrival" type="date" value={form.arrival} onChange={(e) => setForm({ ...form, arrival: e.target.value })} /></div>
              <div><Label htmlFor="rot-departure" className="text-xs">Выезд</Label><Input id="rot-departure" type="date" value={form.departure} onChange={(e) => setForm({ ...form, departure: e.target.value })} /></div>
              <div className="grow"><Label htmlFor="rot-address" className="text-xs">Адрес проживания</Label><Input id="rot-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            </div>
            <div className="flex flex-wrap gap-3 items-end">
              {num('beds', 'Мест', 'w-20')}{num('bedCost', 'Место в сутки, ₽')}
              <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={form.meals} onChange={(e) => setForm({ ...form, meals: e.target.checked })} /> питание</label>
              {form.meals && num('mealsCost', 'Питание в сутки, ₽')}
            </div>
            <div className="flex flex-wrap gap-3">
              {num('perDiemWorker', 'Суточные исполнителю, ₽/сут')}{num('perDiemClient', 'Суточные заказчику, ₽/сут')}
              {num('travelWorker', 'Проезд исполнителю, ₽')}{num('travelClient', 'Проезд заказчику, ₽')}
            </div>
            <div className="flex gap-2"><Button onClick={save} disabled={busy}>Сохранить</Button>{rotation && <Button variant="ghost" onClick={() => { setEditing(false); load(); }}>Отмена</Button>}
              {!rotation && <Button variant="ghost" onClick={() => setEditing(false)}>Отмена</Button>}</div>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 text-sm">
            <div><span className="text-muted-foreground">Жильё: </span>{rotation.housing_address ?? 'не указано'}, мест {rotation.housing_beds}</div>
            <div><span className="text-muted-foreground">Питание: </span>{rotation.meals ? 'да' : 'нет'}</div>
            <div><span className="text-muted-foreground">Суточные: </span>исполнителю {rotation.per_diem_worker} ₽, заказчику {rotation.per_diem_client} ₽ в сутки</div>
            <div><span className="text-muted-foreground">Проезд: </span>исполнителю {rotation.travel_worker} ₽, заказчику {rotation.travel_client} ₽</div>
            <div className="sm:col-span-2 flex flex-wrap gap-2 pt-1">
              {canEdit && !closed && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Изменить условия</Button>}
              {canAccrue && <Button variant="outline" size="sm" disabled={busy} onClick={async () => { const n = await run('generate_rotation_accruals', { _order_id: orderId }); if (n !== null) toast({ title: Number(n) ? `Создано начислений: ${n}` : 'Новых начислений нет', description: 'Суточные начисляются за месяцы, в которых пребывание закончилось; проезд — после заезда.' }); }}>Начислить суточные и проезд</Button>}
              {canEdit && <Button variant="ghost" size="sm" disabled={busy} onClick={() => run('remove_order_rotation', { _order_id: orderId }, 'Заказ больше не вахта')}>Снять признак вахты</Button>}
            </div>
          </div>
        )}

        {rotation && (
          <Table>
            <TableHeader><TableRow><TableHead>Исполнитель</TableHead><TableHead>Заезд</TableHead><TableHead>Выезд</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.worker_id}>
                  <TableCell>{m.full_name}</TableCell>
                  <TableCell><Input aria-label={`Заезд ${m.full_name}`} type="date" className="h-8 w-40" defaultValue={m.arrival_date} disabled={!canEdit} onBlur={(e) => e.target.value && e.target.value !== m.arrival_date && run('set_rotation_member', { _order_id: orderId, _worker_id: m.worker_id, _arrival: e.target.value, _departure: m.departure_date })} /></TableCell>
                  <TableCell><Input aria-label={`Выезд ${m.full_name}`} type="date" className="h-8 w-40" defaultValue={m.departure_date} disabled={!canEdit} onBlur={(e) => e.target.value && e.target.value !== m.departure_date && run('set_rotation_member', { _order_id: orderId, _worker_id: m.worker_id, _arrival: m.arrival_date, _departure: e.target.value })} /></TableCell>
                  <TableCell className="text-right">{canEdit && <Button size="sm" variant="ghost" onClick={() => run('remove_rotation_member', { _order_id: orderId, _worker_id: m.worker_id })}>Убрать</Button>}</TableCell>
                </TableRow>
              ))}
              {!members.length && <TableRow><TableCell colSpan={4} className="text-muted-foreground">Пока никто не назначен на смены.</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};
