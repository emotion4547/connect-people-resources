import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/db';
import { CHECKIN_METHODS, COMMON_TIMEZONES, SITE_STATUSES, type Site } from '@/lib/sitesMeta';
import { HOURS_MODES } from '@/lib/timesheetsMeta';
import type { StaffOption } from '@/lib/clientsMeta';

interface Props { site: Site; clients: { id: string; name: string }[]; staff: StaffOption[]; canEdit: boolean; onSaved: () => void }
const NONE = '__none__';

export const SiteForm: React.FC<Props> = ({ site, clients, staff, canEdit, onSaved }) => {
  const { toast } = useToast();
  const [form, setForm] = useState<Site>(site);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Site>(key: K, value: Site[K]) => setForm((f) => ({ ...f, [key]: value }));
  const text = (key: keyof Site) => (form[key] as string | null) ?? '';
  const toNum = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));

  const save = async () => {
    setSaving(true);
    const { error } = await db('sites').update({
      name: form.name.trim(), client_id: form.client_id, address: form.address || null, city: form.city || null,
      latitude: form.latitude, longitude: form.longitude, checkin_radius_m: form.checkin_radius_m,
      checkin_method: form.checkin_method, hours_mode: form.hours_mode, instructions: form.instructions || null,
      contact_name: form.contact_name || null, contact_phone: form.contact_phone || null,
      site_manager_id: form.site_manager_id, timezone: form.timezone,
      // Статус «Активный» из «Запуск» ставится кнопкой запуска; здесь — только пауза, закрытие и возврат.
      status: form.status === 'active' && site.status === 'launch' ? 'launch' : form.status,
    }).eq('id', site.id);
    setSaving(false);
    if (error) {
      const description = error.code === '23514' ? 'Проверьте координаты и радиус (от 20 до 5000 м)' : error.message;
      toast({ title: 'Не удалось сохранить', description, variant: 'destructive' });
      return;
    }
    toast({ title: 'Сохранено' });
    onSaved();
  };

  const field = (id: string, label: string, key: keyof Site, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={text(key)} disabled={!canEdit} onChange={(e) => set(key, (e.target.value || null) as never)} {...extra} />
    </div>
  );

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Данные объекта</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="s-name">Название</Label>
            <Input id="s-name" value={form.name} disabled={!canEdit} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Заказчик</Label>
            <Select value={form.client_id ?? NONE} onValueChange={(v) => set('client_id', v === NONE ? null : v)} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Не указан</SelectItem>
                {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Менеджер объекта</Label>
            <Select value={form.site_manager_id ?? NONE} onValueChange={(v) => set('site_manager_id', v === NONE ? null : v)} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Не назначен</SelectItem>
                {staff.filter((s) => s.department === 'sites').map((s) => <SelectItem key={s.user_id} value={s.user_id}>{s.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {field('s-address', 'Адрес', 'address')}
          {field('s-city', 'Город', 'city')}
          <div className="space-y-2">
            <Label htmlFor="s-lat">Широта</Label>
            <Input id="s-lat" inputMode="decimal" value={form.latitude ?? ''} disabled={!canEdit} onChange={(e) => set('latitude', toNum(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-lon">Долгота</Label>
            <Input id="s-lon" inputMode="decimal" value={form.longitude ?? ''} disabled={!canEdit} onChange={(e) => set('longitude', toNum(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label>Способ отметки</Label>
            <Select value={form.checkin_method} onValueChange={(v) => set('checkin_method', v)} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(CHECKIN_METHODS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Учёт часов</Label>
            <Select value={form.hours_mode} onValueChange={(v) => set('hours_mode', v)} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(HOURS_MODES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-radius">Радиус отметки, м</Label>
            <Input id="s-radius" inputMode="numeric" placeholder="по умолчанию из правил (200)" value={form.checkin_radius_m ?? ''} disabled={!canEdit}
              onChange={(e) => set('checkin_radius_m', toNum(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-tz">Часовой пояс</Label>
            <Input id="s-tz" list="tz-list" value={form.timezone} disabled={!canEdit} onChange={(e) => set('timezone', e.target.value)} />
            <datalist id="tz-list">{COMMON_TIMEZONES.map((z) => <option key={z} value={z} />)}</datalist>
          </div>
          <div className="space-y-2">
            <Label>Статус</Label>
            <Select value={form.status} onValueChange={(v) => set('status', v)} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(SITE_STATUSES).filter(([k]) => k !== 'active' || site.status !== 'launch').map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            {site.status === 'launch' && <p className="text-xs text-muted-foreground">Из «Запуск» объект переходит в «Активный» кнопкой на вкладке «Запуск».</p>}
          </div>
          {field('s-contact', 'Контакт на месте', 'contact_name')}
          {field('s-phone', 'Телефон контакта', 'contact_phone', { inputMode: 'tel' })}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="s-instr">Инструкция для исполнителя</Label>
            <Textarea id="s-instr" rows={4} placeholder="Как пройти, дресс-код, что взять с собой" value={form.instructions ?? ''} disabled={!canEdit}
              onChange={(e) => set('instructions', e.target.value)} />
          </div>
        </div>
        {canEdit && <Button onClick={save} disabled={saving || !form.name.trim()}>{saving ? 'Сохранение…' : 'Сохранить'}</Button>}
      </CardContent>
    </Card>
  );
};
