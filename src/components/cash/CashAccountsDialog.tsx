import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { rpc } from '@/lib/db';
import { today } from '@/lib/format';
import { ACCOUNT_KINDS, type CashAccount } from '@/lib/cashMeta';

interface Props { orgId: string | null; accounts: CashAccount[]; open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }
interface Form { id: string | null; kind: string; name: string; bank_name: string; account_number: string; opening_balance: string; opening_date: string; is_active: boolean }

const empty = (): Form => ({ id: null, kind: 'bank', name: '', bank_name: '', account_number: '', opening_balance: '0', opening_date: today(), is_active: true });
const fromAccount = (a: CashAccount): Form => ({ id: a.id, kind: a.kind, name: a.name, bank_name: a.bank_name ?? '', account_number: a.account_number ?? '', opening_balance: String(a.opening_balance), opening_date: a.opening_date, is_active: a.is_active });

// Счета денег: расчётные, касса, платформа выплат. Остаток на начало и его дата задают точку отсчёта для ДДС и платёжного календаря.
export const CashAccountsDialog: React.FC<Props> = ({ orgId, accounts, open, onOpenChange, onSaved }) => {
  const { toast } = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!orgId || !form) return;
    const balance = Number(form.opening_balance.replace(/\s/g, '').replace(',', '.'));
    if (Number.isNaN(balance)) { toast({ title: 'Остаток должен быть числом', variant: 'destructive' }); return; }
    setBusy(true);
    const { error } = await rpc('save_cash_account', {
      _org_id: orgId, _id: form.id, _kind: form.kind, _name: form.name, _bank_name: form.bank_name, _account_number: form.account_number,
      _opening_balance: balance, _opening_date: form.opening_date, _is_active: form.is_active,
    });
    setBusy(false);
    if (error) { toast({ title: 'Не удалось сохранить счёт', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Счёт сохранён' });
    setForm(null); onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setForm(null); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Счета</DialogTitle>
          <DialogDescription>Остаток на начало и его дата — точка отсчёта: операции раньше этой даты в остаток не входят. Внесите остаток из выписки банка на выбранную дату.</DialogDescription>
        </DialogHeader>
        {!form ? (
          <div className="space-y-2">
            {accounts.map((a) => (
              <div key={a.id} className={`flex flex-wrap items-center justify-between gap-2 border rounded p-3 text-sm ${a.is_active ? '' : 'opacity-60'}`}>
                <div><div className="font-medium">{a.name}{!a.is_active && ' (выключен)'}</div><div className="text-muted-foreground">{ACCOUNT_KINDS[a.kind]}{a.account_number ? ` · ${a.account_number}` : ''} · остаток {a.opening_balance} ₽ на {a.opening_date.split('-').reverse().join('.')}</div></div>
                <Button size="sm" variant="outline" onClick={() => setForm(fromAccount(a))}>Изменить</Button>
              </div>
            ))}
            <Button variant="outline" onClick={() => setForm(empty())}>Добавить счёт</Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="ca-kind">Вид</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}><SelectTrigger id="ca-kind"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(ACCOUNT_KINDS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
            <div><Label htmlFor="ca-name">Название</Label><Input id="ca-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label htmlFor="ca-bank">Банк</Label><Input id="ca-bank" value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} /></div>
            <div><Label htmlFor="ca-num">Номер счёта</Label><Input id="ca-num" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} /></div>
            <div><Label htmlFor="ca-bal">Остаток на начало, ₽</Label><Input id="ca-bal" inputMode="decimal" value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} /></div>
            <div><Label htmlFor="ca-date">Остаток на дату</Label><Input id="ca-date" type="date" value={form.opening_date} onChange={(e) => setForm({ ...form, opening_date: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> счёт используется</label>
            <DialogFooter className="sm:col-span-2"><Button variant="outline" onClick={() => setForm(null)}>Назад</Button><Button onClick={save} disabled={busy}>Сохранить</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
