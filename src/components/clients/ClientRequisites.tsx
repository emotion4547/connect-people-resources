import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db, rpc } from '@/lib/db';
import { CLIENT_STATUSES, type StaffOption } from '@/lib/clientsMeta';

export interface Client {
  id: string; org_id: string; name: string; legal_name: string | null; inn: string | null; kpp: string | null;
  ogrn: string | null; legal_address: string | null; bank_name: string | null; bank_account: string | null;
  bik: string | null; city: string | null; status: string; archive_reason: string | null;
  sales_manager_id: string | null; sites_manager_id: string | null; notes: string | null;
}

interface Props { client: Client; staff: StaffOption[]; canEdit: boolean; onSaved: () => void }

const NONE = '__none__';

export const ClientRequisites: React.FC<Props> = ({ client, staff, canEdit, onSaved }) => {
  const { toast } = useToast();
  const [form, setForm] = useState<Client>(client);
  const [saving, setSaving] = useState(false);
  const [handoffTo, setHandoffTo] = useState('');

  const set = <K extends keyof Client>(key: K, value: Client[K]) => setForm((f) => ({ ...f, [key]: value }));
  const text = (key: keyof Client) => (form[key] as string | null) ?? '';
  const salesStaff = staff.filter((s) => s.department === 'sales');
  const siteStaff = staff.filter((s) => s.department === 'sites');

  const save = async () => {
    if (form.status === 'archived' && !form.archive_reason?.trim()) {
      toast({ title: 'Для архива нужна причина', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await db('clients').update({
      name: form.name.trim(), legal_name: form.legal_name || null, inn: form.inn || null, kpp: form.kpp || null,
      ogrn: form.ogrn || null, legal_address: form.legal_address || null, bank_name: form.bank_name || null,
      bank_account: form.bank_account || null, bik: form.bik || null, city: form.city || null, status: form.status,
      archive_reason: form.status === 'archived' ? form.archive_reason : null,
      sales_manager_id: form.sales_manager_id, notes: form.notes || null,
    }).eq('id', client.id);
    setSaving(false);
    if (error) {
      const description = error.code === '23505' ? 'Заказчик с таким ИНН уже есть' : error.code === '23514' ? 'Проверьте ИНН (10 или 12 цифр)' : error.message;
      toast({ title: 'Не удалось сохранить', description, variant: 'destructive' });
      return;
    }
    toast({ title: 'Сохранено' });
    onSaved();
  };

  const handoff = async () => {
    const { error } = await rpc('handoff_client', { _client_id: client.id, _sites_manager_id: handoffTo });
    if (error) {
      toast({ title: 'Не удалось передать', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Заказчик передан в ведение объектов' });
    setHandoffTo('');
    onSaved();
  };

  const field = (id: string, label: string, key: keyof Client, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={text(key)} disabled={!canEdit} onChange={(e) => set(key, (e.target.value || null) as never)} {...extra} />
    </div>
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-lg">Реквизиты</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="c-name">Название</Label>
              <Input id="c-name" value={form.name} disabled={!canEdit} onChange={(e) => set('name', e.target.value)} />
            </div>
            {field('c-legal', 'Юридическое название', 'legal_name')}
            {field('c-city', 'Город', 'city')}
            {field('c-inn', 'ИНН', 'inn', { inputMode: 'numeric' })}
            {field('c-kpp', 'КПП', 'kpp', { inputMode: 'numeric' })}
            {field('c-ogrn', 'ОГРН', 'ogrn', { inputMode: 'numeric' })}
            {field('c-address', 'Юридический адрес', 'legal_address')}
            {field('c-bank', 'Банк', 'bank_name')}
            {field('c-bik', 'БИК', 'bik', { inputMode: 'numeric' })}
            {field('c-account', 'Расчётный счёт', 'bank_account', { inputMode: 'numeric' })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Статус и ответственные</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Статус</Label>
              <Select value={form.status} onValueChange={(v) => set('status', v)} disabled={!canEdit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CLIENT_STATUSES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">«Активный» ставится сам при первой смене.</p>
            </div>
            <div className="space-y-2">
              <Label>Менеджер по продажам</Label>
              <Select value={form.sales_manager_id ?? NONE} onValueChange={(v) => set('sales_manager_id', v === NONE ? null : v)} disabled={!canEdit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Не назначен</SelectItem>
                  {salesStaff.map((s) => <SelectItem key={s.user_id} value={s.user_id}>{s.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {form.status === 'archived' && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="c-archive">Причина архива</Label>
                <Input id="c-archive" value={form.archive_reason ?? ''} disabled={!canEdit} onChange={(e) => set('archive_reason', e.target.value)} />
              </div>
            )}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="c-notes">Заметки</Label>
              <Textarea id="c-notes" value={form.notes ?? ''} disabled={!canEdit} onChange={(e) => set('notes', e.target.value)} />
            </div>
          </div>
          {canEdit && <Button onClick={save} disabled={saving || !form.name.trim()}>{saving ? 'Сохранение…' : 'Сохранить'}</Button>}
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Передача в ведение объектов</CardTitle>
            <CardDescription>
              Менеджер объектов запускает объекты заказчика и принимает его заказы. Сейчас: {siteStaff.find((s) => s.user_id === client.sites_manager_id)?.full_name ?? 'не назначен'}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Select value={handoffTo} onValueChange={setHandoffTo}>
              <SelectTrigger className="w-72" aria-label="Менеджер объектов"><SelectValue placeholder="Выберите менеджера объектов" /></SelectTrigger>
              <SelectContent>
                {siteStaff.map((s) => <SelectItem key={s.user_id} value={s.user_id}>{s.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" disabled={!handoffTo} onClick={handoff}>Передать в запуск</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
