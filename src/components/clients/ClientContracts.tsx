import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/db';
import { addDays, fmtDate, today } from '@/lib/format';
import { BILLING_PERIODS, CONTRACT_STATUSES } from '@/lib/clientsMeta';

interface Contract {
  id: string; number: string; signed_on: string; valid_until: string | null; billing_period: string;
  payment_delay_days: number; status: string;
}

const emptyForm = { number: '', signed_on: today(), valid_until: '', billing_period: 'month', payment_delay_days: '0' };

export const ClientContracts: React.FC<{ clientId: string; orgId: string; canEdit: boolean }> = ({ clientId, orgId, canEdit }) => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Contract[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await db('contracts').select('*').eq('client_id', clientId).order('signed_on', { ascending: false });
    if (error) toast({ title: 'Не удалось загрузить договоры', description: error.message, variant: 'destructive' });
    else setRows(data ?? []);
  }, [clientId, toast]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    setSaving(true);
    const { error } = await db('contracts').insert({
      org_id: orgId, client_id: clientId, number: form.number.trim(), signed_on: form.signed_on,
      valid_until: form.valid_until || null, billing_period: form.billing_period,
      payment_delay_days: Number(form.payment_delay_days) || 0,
    });
    setSaving(false);
    if (error) {
      const description = error.code === '23505' ? 'Договор с таким номером уже есть' : error.code === '23514' ? 'Проверьте даты: срок не раньше подписания' : error.message;
      toast({ title: 'Не удалось добавить договор', description, variant: 'destructive' });
      return;
    }
    setOpen(false);
    setForm(emptyForm);
    load();
  };

  const setStatus = async (id: string, status: string) => {
    const { error } = await db('contracts').update({ status }).eq('id', id);
    if (error) toast({ title: 'Не удалось изменить статус', description: error.message, variant: 'destructive' });
    else load();
  };

  const expiry = (c: Contract) => {
    if (c.status !== 'active' || !c.valid_until) return null;
    if (c.valid_until < today()) return <Badge variant="destructive">срок истёк</Badge>;
    if (c.valid_until <= addDays(today(), 30)) return <Badge variant="outline">заканчивается {fmtDate(c.valid_until)}</Badge>;
    return null;
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg">Договоры</CardTitle>
        {canEdit && <Button size="sm" onClick={() => setOpen(true)}>Добавить договор</Button>}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Номер</TableHead><TableHead>Подписан</TableHead><TableHead>Действует до</TableHead><TableHead>Счета</TableHead><TableHead>Отсрочка</TableHead><TableHead>Статус</TableHead><TableHead className="w-48" /></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.number}</TableCell>
                <TableCell>{fmtDate(c.signed_on)}</TableCell>
                <TableCell>{c.valid_until ? fmtDate(c.valid_until) : 'бессрочно'} {expiry(c)}</TableCell>
                <TableCell>{BILLING_PERIODS[c.billing_period]}</TableCell>
                <TableCell>{c.payment_delay_days} дн.</TableCell>
                <TableCell><Badge variant={c.status === 'active' ? 'default' : 'secondary'}>{CONTRACT_STATUSES[c.status]}</Badge></TableCell>
                <TableCell className="text-right space-x-2">
                  {canEdit && c.status === 'draft' && <Button variant="outline" size="sm" onClick={() => setStatus(c.id, 'active')}>Действует</Button>}
                  {canEdit && c.status === 'active' && <Button variant="outline" size="sm" onClick={() => setStatus(c.id, 'terminated')}>Расторгнут</Button>}
                </TableCell>
              </TableRow>
            ))}
            {!rows.length && <TableRow><TableCell colSpan={7} className="text-muted-foreground">Договоров пока нет. Без действующего договора нельзя выставить акт.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Новый договор</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="k-number">Номер</Label><Input id="k-number" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="k-signed">Подписан</Label><Input id="k-signed" type="date" value={form.signed_on} onChange={(e) => setForm({ ...form, signed_on: e.target.value })} /></div>
            <div className="space-y-2"><Label htmlFor="k-until">Действует до</Label><Input id="k-until" type="date" value={form.valid_until} onChange={(e) => setForm({ ...form, valid_until: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Период выставления</Label>
              <Select value={form.billing_period} onValueChange={(v) => setForm({ ...form, billing_period: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(BILLING_PERIODS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label htmlFor="k-delay">Отсрочка оплаты, дней</Label><Input id="k-delay" inputMode="numeric" value={form.payment_delay_days} onChange={(e) => setForm({ ...form, payment_delay_days: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
            <Button onClick={add} disabled={saving || !form.number.trim()}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};
