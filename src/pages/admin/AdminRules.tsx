import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/contexts/OrgContext';
import PageMeta from '@/components/PageMeta';
import { SlidersHorizontal } from 'lucide-react';

// Таблицы шага 2 появились после генерации src/integrations/supabase/types.ts,
// поэтому типы строк описаны здесь, а обращение к ним идёт мимо сгенерированных типов.
interface Definition {
  key: string; group_name: string; label: string; description: string | null;
  value_type: 'number' | 'time' | 'text' | 'boolean' | 'json';
  default_value: unknown; nullable: boolean; unit: string | null;
  min_value: number | null; max_value: number | null; allowed_values: string[] | null;
  levels: string[]; needs_confirmation: boolean; sort_order: number;
}
interface SettingRow { id: number; key: string; value: unknown; effective_from: string; note: string | null; scope_type: string }
interface TaxRate {
  id: number; status: string; ndfl_pct: number; contributions_pct: number; payout_fee_pct: number;
  effective_from: string; confirmed: boolean; note: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = (table: string) => (supabase as any).from(table);

const CHANNELS = [
  { id: 'app', label: 'В системе' }, { id: 'max', label: 'MAX' },
  { id: 'email', label: 'Email' }, { id: 'sms', label: 'SMS' },
];
const TAX_STATUSES: Record<string, string> = {
  ip: 'ИП', self_employed: 'Самозанятый', gph: 'ГПХ', employment: 'Трудовой договор',
};
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: string) => d.split('-').reverse().join('.');

function formatValue(def: Definition, value: unknown): string {
  if (value === null || value === undefined) return 'не задано';
  if (def.key === 'notify.channels' && Array.isArray(value)) {
    return value.map((v) => CHANNELS.find((c) => c.id === v)?.label ?? String(v)).join(', ') || 'нет';
  }
  if (def.value_type === 'boolean') return value ? 'да' : 'нет';
  return def.unit ? `${String(value)} ${def.unit}` : String(value);
}

const AdminRules: React.FC = () => {
  const { toast } = useToast();
  const { orgId, loading: orgLoading } = useOrg();
  const [defs, setDefs] = useState<Definition[]>([]);
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);

  const [editDef, setEditDef] = useState<Definition | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editChannels, setEditChannels] = useState<string[]>([]);
  const [editFrom, setEditFrom] = useState(today());
  const [editNote, setEditNote] = useState('');

  const [editStatus, setEditStatus] = useState<string | null>(null);
  const [rateForm, setRateForm] = useState({ ndfl: '0', contrib: '0', fee: '0', confirmed: false, from: today() });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (org: string) => {
    const [s, r] = await Promise.all([
      db('org_settings').select('id,key,value,effective_from,note,scope_type').eq('org_id', org).eq('scope_type', 'org'),
      db('tax_status_rates').select('*').eq('org_id', org).order('effective_from', { ascending: false }),
    ]);
    if (s.error || r.error) {
      toast({ title: 'Не удалось загрузить данные', description: (s.error ?? r.error).message, variant: 'destructive' });
      return;
    }
    setSettings(s.data ?? []);
    setRates(r.data ?? []);
  }, [toast]);

  useEffect(() => {
    (async () => {
      const d = await db('setting_definitions').select('*').order('sort_order');
      if (d.error) {
        toast({ title: 'Не удалось загрузить данные', description: d.error.message, variant: 'destructive' });
      } else {
        setDefs(d.data ?? []);
      }
      setLoading(false);
    })();
  }, [toast]);

  useEffect(() => { if (orgId) load(orgId); }, [orgId, load]);

  // Для каждой настройки: действующее значение, откуда оно, и ближайшее запланированное.
  const rows = useMemo(() => defs.map((def) => {
    const own = settings.filter((s) => s.key === def.key);
    const current = own.filter((s) => s.effective_from <= today()).sort((a, b) => (b.effective_from.localeCompare(a.effective_from)) || (b.id - a.id))[0];
    const planned = own.filter((s) => s.effective_from > today()).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0];
    return { def, current, planned };
  }), [defs, settings]);

  const groups = useMemo(() => Array.from(new Set(defs.map((d) => d.group_name))), [defs]);

  const openEdit = (def: Definition, current?: SettingRow) => {
    const v = current ? current.value : def.default_value;
    setEditDef(def);
    setEditValue(v === null || v === undefined ? '' : String(v));
    setEditChannels(Array.isArray(v) ? (v as string[]) : []);
    setEditFrom(today());
    setEditNote('');
  };

  const saveSetting = async () => {
    if (!editDef || !orgId) return;
    let value: unknown;
    if (editDef.key === 'notify.channels') value = editChannels;
    else if (editDef.value_type === 'number') value = editValue.trim() === '' ? null : Number(editValue.replace(',', '.'));
    else if (editDef.value_type === 'boolean') value = editValue === 'true';
    else value = editValue;
    if (editDef.value_type === 'number' && value !== null && Number.isNaN(value)) {
      toast({ title: 'Введите число', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await db('org_settings').insert({
      org_id: orgId, key: editDef.key, value, effective_from: editFrom, note: editNote || null,
    });
    setSaving(false);
    if (error) {
      const duplicate = error.code === '23505';
      toast({
        title: duplicate ? 'На эту дату уже есть значение' : 'Не удалось сохранить',
        description: duplicate ? 'Выберите другую дату вступления в силу.' : error.message,
        variant: 'destructive',
      });
      return;
    }
    toast({ title: 'Сохранено', description: editFrom > today() ? `Вступит в силу ${fmtDate(editFrom)}` : 'Действует с сегодняшнего дня' });
    setEditDef(null);
    load(orgId);
  };

  const openRate = (status: string) => {
    const cur = rates.filter((r) => r.status === status && r.effective_from <= today())[0];
    setEditStatus(status);
    setRateForm({
      ndfl: String(cur?.ndfl_pct ?? 0), contrib: String(cur?.contributions_pct ?? 0),
      fee: String(cur?.payout_fee_pct ?? 0), confirmed: false, from: today(),
    });
  };

  const saveRate = async () => {
    if (!editStatus || !orgId) return;
    setSaving(true);
    const { error } = await db('tax_status_rates').insert({
      org_id: orgId, status: editStatus,
      ndfl_pct: Number(rateForm.ndfl.replace(',', '.')),
      contributions_pct: Number(rateForm.contrib.replace(',', '.')),
      payout_fee_pct: Number(rateForm.fee.replace(',', '.')),
      confirmed: rateForm.confirmed, effective_from: rateForm.from,
    });
    setSaving(false);
    if (error) {
      toast({
        title: error.code === '23505' ? 'На эту дату уже есть ставка' : 'Не удалось сохранить',
        description: error.code === '23505' ? 'Выберите другую дату вступления в силу.' : error.message,
        variant: 'destructive',
      });
      return;
    }
    toast({ title: 'Ставка сохранена' });
    setEditStatus(null);
    load(orgId);
  };

  return (
    <DashboardLayout role="admin">
      <PageMeta title="Правила и ставки" description="Настройки правил работы и налоговые ставки" />
      <div className="max-w-4xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Правила и ставки</h1>
            <p className="text-muted-foreground">
              Изменение действует с выбранной даты и не пересчитывает прошлые начисления.
            </p>
          </div>
        </div>

        {loading || orgLoading ? (
          <p className="text-muted-foreground">Загрузка…</p>
        ) : !orgId ? (
          <p className="text-muted-foreground">Нет доступных организаций.</p>
        ) : (
          <Tabs defaultValue="rules">
            <TabsList>
              <TabsTrigger value="rules">Правила</TabsTrigger>
              <TabsTrigger value="tax">Налоговые ставки</TabsTrigger>
            </TabsList>

            <TabsContent value="rules" className="space-y-6">
              {groups.map((group) => (
                <Card key={group}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <SlidersHorizontal className="w-4 h-4" /> {group}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Правило</TableHead>
                          <TableHead>Сейчас</TableHead>
                          <TableHead className="w-28" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.filter((r) => r.def.group_name === group).map(({ def, current, planned }) => (
                          <TableRow key={def.key}>
                            <TableCell>
                              <div className="font-medium">{def.label}</div>
                              {def.description && <div className="text-xs text-muted-foreground">{def.description}</div>}
                              {def.needs_confirmation && (
                                <Badge variant="outline" className="mt-1">значение из ТЗ, клиент не подтвердил</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <div>{formatValue(def, current ? current.value : def.default_value)}</div>
                              <div className="text-xs text-muted-foreground">
                                {current ? `задано с ${fmtDate(current.effective_from)}` : 'по умолчанию'}
                              </div>
                              {planned && (
                                <div className="text-xs text-primary">
                                  с {fmtDate(planned.effective_from)}: {formatValue(def, planned.value)}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button variant="outline" size="sm" onClick={() => openEdit(def, current)}>Изменить</Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            <TabsContent value="tax">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Налоговые статусы исполнителей</CardTitle>
                  <CardDescription>
                    Ставки влияют на себестоимость и маржу. Пока бухгалтерия не подтвердила значения, они помечены.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Статус</TableHead>
                        <TableHead>НДФЛ, %</TableHead>
                        <TableHead>Взносы, %</TableHead>
                        <TableHead>Комиссия выплаты, %</TableHead>
                        <TableHead className="w-28" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(TAX_STATUSES).map(([status, label]) => {
                        const cur = rates.filter((r) => r.status === status && r.effective_from <= today())[0];
                        const next = rates.filter((r) => r.status === status && r.effective_from > today()).slice(-1)[0];
                        return (
                          <TableRow key={status}>
                            <TableCell>
                              <div className="font-medium">{label}</div>
                              {cur && !cur.confirmed && <Badge variant="outline" className="mt-1">не подтверждено</Badge>}
                              {next && (
                                <div className="text-xs text-primary">
                                  с {fmtDate(next.effective_from)}: {next.ndfl_pct}/{next.contributions_pct}/{next.payout_fee_pct}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>{cur?.ndfl_pct ?? '—'}</TableCell>
                            <TableCell>{cur?.contributions_pct ?? '—'}</TableCell>
                            <TableCell>{cur?.payout_fee_pct ?? '—'}</TableCell>
                            <TableCell>
                              <Button variant="outline" size="sm" onClick={() => openRate(status)}>Изменить</Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>

      <Dialog open={!!editDef} onOpenChange={(open) => !open && setEditDef(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editDef?.label}</DialogTitle>
            <DialogDescription>
              Новое значение заводится отдельной записью с датой вступления в силу. Задним числом менять нельзя.
            </DialogDescription>
          </DialogHeader>
          {editDef && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Значение{editDef.unit ? `, ${editDef.unit}` : ''}</Label>
                {editDef.key === 'notify.channels' ? (
                  <div className="flex flex-wrap gap-4">
                    {CHANNELS.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={editChannels.includes(c.id)}
                          onCheckedChange={(on) => setEditChannels((prev) => on ? [...prev, c.id] : prev.filter((x) => x !== c.id))}
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                ) : editDef.allowed_values ? (
                  <Select value={editValue} onValueChange={setEditValue}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {editDef.allowed_values.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type={editDef.value_type === 'time' ? 'time' : 'text'}
                    inputMode={editDef.value_type === 'number' ? 'decimal' : undefined}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder={editDef.nullable ? 'пусто — не применяется' : undefined}
                  />
                )}
                {editDef.value_type === 'number' && editDef.min_value !== null && editDef.max_value !== null && (
                  <p className="text-xs text-muted-foreground">Допустимо от {editDef.min_value} до {editDef.max_value}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule-from">Действует с</Label>
                <Input id="rule-from" type="date" min={today()} value={editFrom} onChange={(e) => setEditFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rule-note">Комментарий</Label>
                <Input id="rule-note" value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="Почему меняем" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDef(null)}>Отмена</Button>
            <Button onClick={saveSetting} disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editStatus} onOpenChange={(open) => !open && setEditStatus(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ставки: {editStatus ? TAX_STATUSES[editStatus] : ''}</DialogTitle>
            <DialogDescription>Новая ставка действует с выбранной даты, старые начисления не меняются.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            {([['ndfl', 'НДФЛ, %'], ['contrib', 'Взносы, %'], ['fee', 'Комиссия, %']] as const).map(([k, label]) => (
              <div key={k} className="space-y-2">
                <Label htmlFor={`rate-${k}`}>{label}</Label>
                <Input
                  id={`rate-${k}`} inputMode="decimal" value={rateForm[k]}
                  onChange={(e) => setRateForm((f) => ({ ...f, [k]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="rate-from">Действует с</Label>
            <Input id="rate-from" type="date" min={today()} value={rateForm.from} onChange={(e) => setRateForm((f) => ({ ...f, from: e.target.value }))} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={rateForm.confirmed} onCheckedChange={(on) => setRateForm((f) => ({ ...f, confirmed: on === true }))} />
            Ставки подтверждены бухгалтерией
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditStatus(null)}>Отмена</Button>
            <Button onClick={saveRate} disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminRules;
