import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { db } from '@/lib/db';

interface Contact {
  id: string; full_name: string; job_title: string | null; phone: string | null; email: string | null;
  is_signer: boolean; user_id: string | null; cabinet_role: string | null;
}

const empty = { full_name: '', job_title: '', phone: '', email: '', is_signer: false };

export const ClientContacts: React.FC<{ clientId: string; orgId: string; canEdit: boolean }> = ({ clientId, orgId, canEdit }) => {
  const { toast } = useToast();
  const [rows, setRows] = useState<Contact[]>([]);
  const [form, setForm] = useState(empty);

  const load = useCallback(async () => {
    const { data, error } = await db('client_contacts').select('*').eq('client_id', clientId).order('created_at');
    if (error) toast({ title: 'Не удалось загрузить контакты', description: error.message, variant: 'destructive' });
    else setRows(data ?? []);
  }, [clientId, toast]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const { error } = await db('client_contacts').insert({
      org_id: orgId, client_id: clientId, full_name: form.full_name.trim(), job_title: form.job_title || null,
      phone: form.phone || null, email: form.email || null, is_signer: form.is_signer,
    });
    if (error) {
      toast({ title: 'Не удалось добавить', description: error.message, variant: 'destructive' });
      return;
    }
    setForm(empty);
    load();
  };

  const remove = async (id: string) => {
    const { error } = await db('client_contacts').delete().eq('id', id);
    if (error) toast({ title: 'Не удалось удалить', description: error.message, variant: 'destructive' });
    else load();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Контакты</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow><TableHead>ФИО</TableHead><TableHead>Должность</TableHead><TableHead>Связь</TableHead><TableHead>Кабинет</TableHead><TableHead className="w-24" /></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.full_name}{c.is_signer && <Badge variant="outline" className="ml-2">подписант</Badge>}</TableCell>
                <TableCell>{c.job_title ?? '—'}</TableCell>
                <TableCell><div>{c.phone ?? '—'}</div><div className="text-xs text-muted-foreground">{c.email}</div></TableCell>
                <TableCell>{c.user_id ? <Badge variant="secondary">{c.cabinet_role === 'client_admin' ? 'администратор' : 'менеджер'}</Badge> : '—'}</TableCell>
                <TableCell>{canEdit && !c.user_id && <Button variant="ghost" size="sm" onClick={() => remove(c.id)}>Удалить</Button>}</TableCell>
              </TableRow>
            ))}
            {!rows.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Контактов пока нет.</TableCell></TableRow>}
          </TableBody>
        </Table>

        {canEdit && (
          <form className="grid gap-3 sm:grid-cols-5 items-end" onSubmit={(e) => { e.preventDefault(); add(); }}>
            <Input placeholder="ФИО" aria-label="ФИО" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            <Input placeholder="Должность" aria-label="Должность" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
            <Input placeholder="Телефон" aria-label="Телефон" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input placeholder="Email" aria-label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.is_signer} onCheckedChange={(on) => setForm({ ...form, is_signer: on === true })} />Подписант</label>
              <Button type="submit" disabled={!form.full_name.trim()}>Добавить</Button>
            </div>
          </form>
        )}
        <p className="text-xs text-muted-foreground">Доступ в кабинет заказчика выдаёт администратор системы; приглашение письмом появится после подключения почты.</p>
      </CardContent>
    </Card>
  );
};
