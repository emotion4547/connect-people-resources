import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { db, rpc } from '@/lib/db';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import { TARIFF_STATUSES, UNITS } from '@/lib/clientsMeta';
import { MarginCalculator } from '@/components/clients/MarginCalculator';

interface Tariff {
  id: string; site_id: string | null; position_id: string; unit: string; client_rate: number; worker_rate: number;
  night_coef: number; holiday_coef: number; overtime_coef: number; min_paid_hours: number;
  min_paid_hours_for_worker: boolean; valid_from: string; valid_to: string | null; status: string; note: string | null;
}
interface Option { id: string; name: string }

const ALL_SITES = '__all__';
const emptyForm = {
  id: '' as string, position_id: '', site_id: ALL_SITES, unit: 'hour', client_rate: '', worker_rate: '',
  night_coef: '1', holiday_coef: '1', overtime_coef: '1', min_paid_hours: '0', min_for_worker: false,
  valid_from: today(), valid_to: '',
};

const num = (s: string) => Number(s.replace(',', '.'));

export const ClientTariffs: React.FC<{ clientId: string; orgId: string; canEdit: boolean }> = ({ clientId, orgId, canEdit }) => {
  const { toast } = useToast();
  const { role } = useAuth();
  const [rows, setRows] = useState<Tariff[]>([]);
  const [positions, setPositions] = useState<Option[]>([]);
  const [sites, setSites] = useState<Option[]>([]);
  const [pctById, setPctById] = useState<Record<string, number | null>>({});
  const [threshold, setThreshold] = useState<number | null>(null);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [version, setVersion] = useState<{ id: string; client_rate: string; worker_rate: string; valid_from: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const canApprove = role === 'director' || role === 'sales';

  const load = useCallback(async () => {
    const [t, p, s, th, basis] = await Promise.all([
      db('tariffs').select('*').eq('client_id', clientId).order('valid_from', { ascending: false }),
      db('positions').select('id,name').eq('org_id', orgId).order('sort_order'),
      db('sites').select('id,name').order('name'),
      rpc('get_setting', { _org_id: orgId, _key: 'tariff.min_margin_pct' }),
      rpc('get_setting', { _org_id: orgId, _key: 'tariff.margin_basis' }),
    ]);
    if (t.error) { toast({ title: 'Не удалось загрузить тарифы', description: t.error.message, variant: 'destructive' }); return; }
    const list: Tariff[] = t.data ?? [];
    setRows(list);
    setPositions(p.data ?? []);
    setSites(s.data ?? []);
    setThreshold(th.data === null || th.data === undefined ? null : Number(th.data));

    const pick = basis.data as string | null;
    const entries = await Promise.all(list.map(async (x) => {
      const { data } = await rpc('calc_margins', { _org_id: orgId, _client_rate: x.client_rate, _worker_rate: x.worker_rate, _at: x.valid_from });
      const margins: { status: string; margin_pct: number | null }[] = data ?? [];
      const values = margins.map((m) => m.margin_pct).filter((v): v is number => v !== null);
      let pct: number | null = null;
      if (pick === 'min') pct = values.length ? Math.min(...values) : null;
      else if (pick === 'max') pct = values.length ? Math.max(...values) : null;
      else pct = margins.find((m) => m.status === pick)?.margin_pct ?? null;
      return [x.id, pct] as const;
    }));
    setPctById(Object.fromEntries(entries));
  }, [clientId, orgId, toast]);

  useEffect(() => { load(); }, [load]);

  const positionName = useMemo(() => new Map(positions.map((p) => [p.id, p.name])), [positions]);
  const siteName = useMemo(() => new Map(sites.map((s) => [s.id, s.name])), [sites]);

  const openEdit = (t: Tariff) => setForm({
    id: t.id, position_id: t.position_id, site_id: t.site_id ?? ALL_SITES, unit: t.unit, client_rate: String(t.client_rate),
    worker_rate: String(t.worker_rate), night_coef: String(t.night_coef), holiday_coef: String(t.holiday_coef),
    overtime_coef: String(t.overtime_coef), min_paid_hours: String(t.min_paid_hours),
    min_for_worker: t.min_paid_hours_for_worker, valid_from: t.valid_from, valid_to: t.valid_to ?? '',
  });

  const save = async () => {
    if (!form) return;
    const payload = {
      position_id: form.position_id, site_id: form.site_id === ALL_SITES ? null : form.site_id, unit: form.unit,
      client_rate: num(form.client_rate), worker_rate: num(form.worker_rate), night_coef: num(form.night_coef),
      holiday_coef: num(form.holiday_coef), overtime_coef: num(form.overtime_coef), min_paid_hours: num(form.min_paid_hours),
      min_paid_hours_for_worker: form.min_for_worker, valid_from: form.valid_from, valid_to: form.valid_to || null,
    };
    if ([payload.client_rate, payload.worker_rate, payload.night_coef, payload.holiday_coef, payload.overtime_coef, payload.min_paid_hours].some((n) => !Number.isFinite(n))) {
      toast({ title: 'Проверьте числа', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = form.id
      ? await db('tariffs').update(payload).eq('id', form.id)
      : await db('tariffs').insert({ ...payload, org_id: orgId, client_id: clientId });
    setSaving(false);
    if (error) {
      toast({ title: 'Не удалось сохранить тариф', description: error.code === '23514' ? 'Проверьте даты и числа' : error.message, variant: 'destructive' });
      return;
    }
    setForm(null);
    load();
  };

  const changeStatus = async (id: string, status: string) => {
    const { error } = await rpc('set_tariff_status', { _tariff_id: id, _new_status: status });
    if (error) {
      toast({ title: 'Не удалось изменить статус', description: error.message, variant: 'destructive' });
      return;
    }
    load();
  };

  const remove = async (id: string) => {
    const { error } = await db('tariffs').delete().eq('id', id);
    if (error) toast({ title: 'Не удалось удалить', description: error.message, variant: 'destructive' });
    else load();
  };

  const createVersion = async () => {
    if (!version) return;
    setSaving(true);
    const { error } = await rpc('new_tariff_version', {
      _tariff_id: version.id, _client_rate: num(version.client_rate), _worker_rate: num(version.worker_rate), _valid_from: version.valid_from,
    });
    setSaving(false);
    if (error) {
      toast({ title: 'Не удалось создать версию', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Создан черновик новой версии', description: 'Отправьте его на согласование.' });
    setVersion(null);
    load();
  };

  const pctBadge = (id: string) => {
    const pct = pctById[id];
    if (pct === undefined || pct === null) return '—';
    const low = threshold !== null && pct < threshold;
    return <Badge variant={low ? 'destructive' : 'secondary'}>{pct} %</Badge>;
  };

  const rowForm = (key: keyof typeof emptyForm, label: string, inputMode: 'decimal' | 'numeric' = 'decimal') => form && (
    <div className="space-y-2">
      <Label htmlFor={`t-${key}`}>{label}</Label>
      <Input id={`t-${key}`} inputMode={inputMode} value={String(form[key])} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 gap-4">
        <div>
          <CardTitle className="text-lg">Тарифы</CardTitle>
          <CardDescription>
            Ставки заказчику и исполнителю «на руки». Маржа показана по статусу исполнителя из настройки «Правила и ставки»
            {threshold !== null && `; порог без согласования руководителя компании — ${threshold} %`}.
          </CardDescription>
        </div>
        {canEdit && <Button size="sm" onClick={() => setForm({ ...emptyForm })}>Добавить тариф</Button>}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Позиция</TableHead><TableHead>Объект</TableHead><TableHead>Заказчику</TableHead><TableHead>Исполнителю</TableHead>
              <TableHead>Маржа</TableHead><TableHead>Период</TableHead><TableHead>Статус</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{positionName.get(t.position_id) ?? '—'}</TableCell>
                <TableCell>{t.site_id ? siteName.get(t.site_id) ?? '—' : 'Все объекты'}</TableCell>
                <TableCell>{fmtMoney(t.client_rate)} / {UNITS[t.unit]}</TableCell>
                <TableCell>{fmtMoney(t.worker_rate)} / {UNITS[t.unit]}</TableCell>
                <TableCell>{pctBadge(t.id)}</TableCell>
                <TableCell>{fmtDate(t.valid_from)} — {t.valid_to ? fmtDate(t.valid_to) : '…'}</TableCell>
                <TableCell><Badge variant={t.status === 'approved' ? 'default' : 'secondary'}>{TARIFF_STATUSES[t.status]}</Badge></TableCell>
                <TableCell className="text-right space-x-2 whitespace-nowrap">
                  {canEdit && t.status === 'draft' && (<>
                    <Button variant="outline" size="sm" onClick={() => openEdit(t)}>Изменить</Button>
                    <Button size="sm" onClick={() => changeStatus(t.id, 'pending')}>На согласование</Button>
                    <Button variant="ghost" size="sm" onClick={() => remove(t.id)}>Удалить</Button>
                  </>)}
                  {t.status === 'pending' && (<>
                    {canApprove && <Button size="sm" onClick={() => changeStatus(t.id, 'approved')}>Утвердить</Button>}
                    {(canApprove || canEdit) && <Button variant="outline" size="sm" onClick={() => changeStatus(t.id, 'draft')}>Вернуть</Button>}
                  </>)}
                  {canEdit && (t.status === 'approved' || t.status === 'closed') && (
                    <Button variant="outline" size="sm" onClick={() => setVersion({ id: t.id, client_rate: String(t.client_rate), worker_rate: String(t.worker_rate), valid_from: today() })}>Новая версия</Button>
                  )}
                  {canEdit && t.status === 'approved' && <Button variant="ghost" size="sm" onClick={() => changeStatus(t.id, 'closed')}>Закрыть</Button>}
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && <TableRow><TableCell colSpan={8} className="text-muted-foreground">Тарифов пока нет. Без утверждённого тарифа заказ создать нельзя.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!form} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? 'Тариф (черновик)' : 'Новый тариф'}</DialogTitle>
            <DialogDescription>После отправки на согласование ставки не правятся: изменение — это новая версия тарифа с даты.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label>Позиция</Label>
                  <Select value={form.position_id} onValueChange={(v) => setForm({ ...form, position_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Выберите" /></SelectTrigger>
                    <SelectContent>{positions.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Объект</Label>
                  <Select value={form.site_id} onValueChange={(v) => setForm({ ...form, site_id: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_SITES}>Все объекты</SelectItem>
                      {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Единица</Label>
                  <Select value={form.unit} onValueChange={(v) => setForm({ ...form, unit: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(UNITS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {rowForm('client_rate', 'Ставка заказчику, ₽')}
                {rowForm('worker_rate', 'Ставка исполнителю на руки, ₽')}
                {rowForm('min_paid_hours', 'Минимум оплачиваемых часов')}
                {rowForm('night_coef', 'Коэффициент: ночь')}
                {rowForm('holiday_coef', 'Коэффициент: праздник')}
                {rowForm('overtime_coef', 'Коэффициент: переработка')}
                <div className="space-y-2">
                  <Label htmlFor="t-valid_from">Действует с</Label>
                  <Input id="t-valid_from" type="date" value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="t-valid_to">Действует по</Label>
                  <Input id="t-valid_to" type="date" value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 text-sm self-end pb-2">
                  <Checkbox checked={form.min_for_worker} onCheckedChange={(on) => setForm({ ...form, min_for_worker: on === true })} />
                  Минимум часов применять и к исполнителю
                </label>
              </div>
              <div>
                <h3 className="font-medium mb-2">Маржа на единицу</h3>
                <MarginCalculator orgId={orgId} clientRate={form.client_rate} workerRate={form.worker_rate} at={form.valid_from} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Отмена</Button>
            <Button onClick={save} disabled={saving || !form?.position_id || !form?.client_rate || !form?.worker_rate}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!version} onOpenChange={(open) => !open && setVersion(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Новая версия тарифа</DialogTitle>
            <DialogDescription>
              Уже созданные смены остаются со старыми ставками. После утверждения прежняя версия закончится накануне.
            </DialogDescription>
          </DialogHeader>
          {version && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2"><Label htmlFor="v-client">Ставка заказчику, ₽</Label><Input id="v-client" inputMode="decimal" value={version.client_rate} onChange={(e) => setVersion({ ...version, client_rate: e.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="v-worker">Исполнителю на руки, ₽</Label><Input id="v-worker" inputMode="decimal" value={version.worker_rate} onChange={(e) => setVersion({ ...version, worker_rate: e.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="v-from">С даты</Label><Input id="v-from" type="date" min={today()} value={version.valid_from} onChange={(e) => setVersion({ ...version, valid_from: e.target.value })} /></div>
              </div>
              <MarginCalculator orgId={orgId} clientRate={version.client_rate} workerRate={version.worker_rate} at={version.valid_from} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setVersion(null)}>Отмена</Button>
            <Button onClick={createVersion} disabled={saving}>Создать черновик</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
