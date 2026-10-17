import React, { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { db, rpc } from '@/lib/db';
import PageMeta from '@/components/PageMeta';
import { Building } from 'lucide-react';

interface OrgCard {
  id: string; name: string; legal_form: 'ООО' | 'ИП'; inn: string | null; kpp: string | null; ogrn: string | null;
  address: string | null; bank_name: string | null; bank_account: string | null; bik: string | null;
  tax_regime: 'usn6' | 'usn15' | 'osno'; vat_rate: number; signer_name: string | null; signer_position: string | null;
  is_active: boolean;
}

const TAX_REGIMES: Record<string, string> = { usn6: 'УСН 6%', usn15: 'УСН 15%', osno: 'ОСНО' };
const DIGITS = /^\d*$/;
const COLUMNS = 'id,name,legal_form,inn,kpp,ogrn,address,bank_name,bank_account,bik,tax_regime,vat_rate,signer_name,signer_position,is_active';

const AdminOrganizations: React.FC = () => {
  const { toast } = useToast();
  const { orgs, orgId, setOrgId, reload } = useOrg();
  const [form, setForm] = useState<OrgCard | null>(null);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newForm, setNewForm] = useState('ООО');

  useEffect(() => {
    if (!orgId) { setForm(null); return; }
    (async () => {
      const { data, error } = await db('organizations').select(COLUMNS).eq('id', orgId).maybeSingle();
      if (error) toast({ title: 'Не удалось загрузить организацию', description: error.message, variant: 'destructive' });
      else setForm(data);
    })();
  }, [orgId, toast]);

  const set = <K extends keyof OrgCard>(key: K, value: OrgCard[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const text = (key: keyof OrgCard) => (form?.[key] as string | null) ?? '';

  const save = async () => {
    if (!form) return;
    const innLen = form.legal_form === 'ИП' ? 12 : 10;
    if (form.inn && (!DIGITS.test(form.inn) || form.inn.length !== innLen)) {
      toast({ title: `ИНН ${form.legal_form === 'ИП' ? 'ИП' : 'организации'} — ${innLen} цифр`, variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { id, ...fields } = form;
    const { error } = await db('organizations').update(fields).eq('id', id);
    setSaving(false);
    if (error) {
      toast({ title: 'Не удалось сохранить', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Организация сохранена' });
    reload();
  };

  const create = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const { data, error } = await rpc('create_organization', { _name: newName.trim(), _legal_form: newForm });
    setSaving(false);
    if (error) {
      toast({ title: 'Не удалось создать организацию', description: error.message, variant: 'destructive' });
      return;
    }
    setCreating(false);
    setNewName('');
    await reload();
    if (data) setOrgId(data as string);
    toast({ title: 'Организация создана', description: 'Вы назначены её администратором.' });
  };

  return (
    <DashboardLayout role="admin">
      <PageMeta title="Организации" description="Юридические лица и ИП, от которых идут договоры и выплаты" />
      <div className="max-w-4xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Организации</h1>
            <p className="text-muted-foreground">Свои юрлица и ИП. Данные системы разделены по организациям.</p>
          </div>
          <Button onClick={() => setCreating(true)}>Добавить организацию</Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {orgs.map((o) => (
            <Button key={o.id} variant={o.id === orgId ? 'default' : 'outline'} onClick={() => setOrgId(o.id)} className="gap-2">
              <Building className="w-4 h-4" /> {o.name}
              {!o.is_active && <Badge variant="outline">отключена</Badge>}
            </Button>
          ))}
        </div>

        {form && (
          <Card>
            <CardHeader>
              <CardTitle>{form.name}</CardTitle>
              <CardDescription>
                Реквизиты попадают в акты и счета (этап 2). Логотип, печать и подпись для PDF добавятся вместе с актами.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="org-name">Название</Label>
                  <Input id="org-name" value={form.name} onChange={(e) => set('name', e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Форма</Label>
                  <Select value={form.legal_form} onValueChange={(v) => set('legal_form', v as OrgCard['legal_form'])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ООО">ООО</SelectItem>
                      <SelectItem value="ИП">ИП</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-inn">ИНН</Label>
                  <Input id="org-inn" inputMode="numeric" value={text('inn')} onChange={(e) => set('inn', e.target.value || null)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-kpp">КПП</Label>
                  <Input id="org-kpp" inputMode="numeric" value={text('kpp')} onChange={(e) => set('kpp', e.target.value || null)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-ogrn">ОГРН / ОГРНИП</Label>
                  <Input id="org-ogrn" inputMode="numeric" value={text('ogrn')} onChange={(e) => set('ogrn', e.target.value || null)} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="org-address">Юридический адрес</Label>
                  <Input id="org-address" value={text('address')} onChange={(e) => set('address', e.target.value || null)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-bank">Банк</Label>
                  <Input id="org-bank" value={text('bank_name')} onChange={(e) => set('bank_name', e.target.value || null)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-bik">БИК</Label>
                  <Input id="org-bik" inputMode="numeric" value={text('bik')} onChange={(e) => set('bik', e.target.value || null)} />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="org-account">Расчётный счёт</Label>
                  <Input id="org-account" inputMode="numeric" value={text('bank_account')} onChange={(e) => set('bank_account', e.target.value || null)} />
                </div>
                <div className="space-y-2">
                  <Label>Налоговый режим</Label>
                  <Select value={form.tax_regime} onValueChange={(v) => set('tax_regime', v as OrgCard['tax_regime'])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(TAX_REGIMES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-vat">Ставка НДС, %</Label>
                  <Input id="org-vat" inputMode="decimal" value={String(form.vat_rate)}
                    onChange={(e) => set('vat_rate', Number(e.target.value.replace(',', '.')) || 0)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-signer">Подписант</Label>
                  <Input id="org-signer" value={text('signer_name')} onChange={(e) => set('signer_name', e.target.value || null)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-signer-pos">Должность подписанта</Label>
                  <Input id="org-signer-pos" value={text('signer_position')} onChange={(e) => set('signer_position', e.target.value || null)} />
                </div>
              </div>
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={form.is_active} onCheckedChange={(on) => set('is_active', on)} />
                Организация работает (отключённая не удаляется, данные сохраняются)
              </label>
              <Button onClick={save} disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</Button>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новая организация</DialogTitle>
            <DialogDescription>Реквизиты можно заполнить после создания. Вы станете её администратором.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-org-name">Название</Label>
              <Input id="new-org-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Форма</Label>
              <Select value={newForm} onValueChange={setNewForm}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ООО">ООО</SelectItem>
                  <SelectItem value="ИП">ИП</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Отмена</Button>
            <Button onClick={create} disabled={saving || !newName.trim()}>Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminOrganizations;
