import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { usePermissions } from '@/hooks/usePermissions';
import { db, rpc } from '@/lib/db';
import { decodeStatement, parseStatement } from '@/lib/kl1c';
import { fmtDate, fmtMoney, today } from '@/lib/format';
import PageMeta from '@/components/PageMeta';
import { Plus, Upload } from 'lucide-react';

interface Payment {
  id: string; client_id: string | null; payment_date: string; amount: number; allocated_amount: number; source: string;
  doc_number: string | null; payer_name: string | null; payer_inn: string | null; purpose: string | null;
}
interface OpenInvoice { id: string; number: string; amount_total: number; due_date: string | null; outstanding: number }

const PaymentsPage: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const { can } = usePermissions();
  const [tab, setTab] = useState<'queue' | 'all'>('queue');
  const [rows, setRows] = useState<Payment[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ client_id: '', date: today(), amount: '', number: '', purpose: '' });

  const [alloc, setAlloc] = useState<Payment | null>(null);
  const [allocClient, setAllocClient] = useState('');
  const [invoices, setInvoices] = useState<OpenInvoice[]>([]);
  const [invoiceId, setInvoiceId] = useState('');
  const [allocAmount, setAllocAmount] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [p, c] = await Promise.all([
      db('client_payments').select('*').eq('org_id', orgId).order('payment_date', { ascending: false }).limit(300),
      db('clients').select('id,name').eq('org_id', orgId).order('name'),
    ]);
    setLoading(false);
    if (p.error) { toast({ title: 'Не удалось загрузить платежи', description: p.error.message, variant: 'destructive' }); return; }
    setRows(p.data ?? []); setClients(c.data ?? []);
  }, [orgId, toast]);

  useEffect(() => { load(); }, [load]);

  const name = (id: string | null) => clients.find((c) => c.id === id)?.name ?? 'не определён';
  const left = (p: Payment) => Number(p.amount) - Number(p.allocated_amount);
  const shown = tab === 'queue' ? rows.filter((r) => !r.client_id || left(r) > 0) : rows;

  const upload = async (f: File | undefined) => {
    if (!f || !orgId) return;
    const parsed = parseStatement(decodeStatement(await f.arrayBuffer()));
    if (!parsed.payments.length && !parsed.outgoing.length) { toast({ title: 'В файле нет платежей', description: 'Проверьте, что это выписка kl_to_1c.txt по нашему счёту.', variant: 'destructive' }); return; }
    setBusy(true);
    const { data, error } = parsed.payments.length
      ? await rpc('import_bank_statement', { _org_id: orgId, _filename: f.name, _account: parsed.account, _payments: parsed.payments })
      : { data: { new: 0, allocated: 0, queue: 0, duplicates: 0 }, error: null };
    // Исходящие платежи по реестрам выплат: отмечают строки «проведена».
    const rec = !error && parsed.outgoing.length ? await rpc('reconcile_bank_statement', { _org_id: orgId, _payments: parsed.outgoing }) : null;
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    if (error) { toast({ title: 'Выписка не загружена', description: error.message, variant: 'destructive' }); return; }
    const paidOut = rec?.data?.matched ?? 0;
    toast({ title: `Загружено: ${data.new}, разнесено само: ${data.allocated}, в очередь: ${data.queue}`,
      description: [data.duplicates ? `Повторов пропущено: ${data.duplicates}` : '', paidOut ? `Выплат отмечено проведёнными: ${paidOut}` : ''].filter(Boolean).join('. ') || undefined });
    load();
  };

  const addPayment = async () => {
    if (!orgId) return;
    setBusy(true);
    const { error } = await rpc('add_client_payment', {
      _org_id: orgId, _client_id: form.client_id || null, _date: form.date, _amount: Number(form.amount.replace(',', '.')), _doc_number: form.number, _purpose: form.purpose,
    });
    setBusy(false);
    if (error) { toast({ title: 'Оплата не добавлена', description: error.message, variant: 'destructive' }); return; }
    setAdding(false); setForm({ client_id: '', date: today(), amount: '', number: '', purpose: '' });
    load();
  };

  const openAlloc = (p: Payment) => { setAlloc(p); setAllocClient(p.client_id ?? ''); setInvoiceId(''); setAllocAmount(String(left(p))); };

  useEffect(() => {
    if (!alloc || !allocClient) { setInvoices([]); return; }
    (async () => {
      const { data } = await db('client_documents').select('id,number,amount_total,due_date').eq('client_id', allocClient).eq('kind', 'invoice')
        .in('status', ['issued', 'signed', 'paid_partial']).order('issue_date');
      const withLeft: OpenInvoice[] = [];
      for (const d of data ?? []) {
        const a = await db('payment_allocations').select('amount').eq('document_id', d.id);
        const paid = (a.data ?? []).reduce((s: number, x: { amount: number }) => s + Number(x.amount), 0);
        if (Number(d.amount_total) - paid > 0) withLeft.push({ ...d, outstanding: Number(d.amount_total) - paid });
      }
      setInvoices(withLeft);
    })();
  }, [alloc, allocClient]);

  const doAlloc = async () => {
    if (!alloc) return;
    setBusy(true);
    if (!alloc.client_id) {
      const a = await rpc('assign_payment_client', { _payment_id: alloc.id, _client_id: allocClient });
      if (a.error) { setBusy(false); toast({ title: 'Не получилось', description: a.error.message, variant: 'destructive' }); return; }
    }
    const { error } = invoiceId ? await rpc('allocate_payment', { _payment_id: alloc.id, _doc_id: invoiceId, _amount: Number(allocAmount.replace(',', '.')) }) : { error: null };
    setBusy(false);
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Сохранено' });
    setAlloc(null);
    load();
  };

  return (
    <AppLayout>
      <PageMeta title="Оплаты" description="Платежи заказчиков и банковская выписка" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Оплаты</h1>
            <p className="text-muted-foreground">Выписка kl_to_1c.txt разносится сама: заказчик — по ИНН, счёт — по номеру в назначении или точной сумме. Остальное в очереди.</p>
          </div>
          {can('client_documents', 'create') && (
            <div className="flex gap-2">
              <Button variant="outline" className="gap-2" disabled={busy} onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4" /> Загрузить выписку</Button>
              <input ref={fileRef} type="file" accept=".txt" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
              <Button className="gap-2" onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Ввести оплату</Button>
            </div>
          )}
        </div>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'queue' | 'all')}>
              <TabsList><TabsTrigger value="queue">Очередь ({rows.filter((r) => !r.client_id || left(r) > 0).length})</TabsTrigger><TabsTrigger value="all">Все платежи</TabsTrigger></TabsList>
            </Tabs>
            {loading ? <p className="text-muted-foreground">Загрузка…</p> : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Дата</TableHead><TableHead>Заказчик</TableHead><TableHead>Назначение</TableHead><TableHead className="text-right">Сумма</TableHead><TableHead className="text-right">Не разнесено</TableHead><TableHead /></TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{fmtDate(p.payment_date)}{p.doc_number && <div className="text-xs text-muted-foreground">п/п № {p.doc_number}</div>}</TableCell>
                      <TableCell>{name(p.client_id)}{p.payer_name && !p.client_id && <div className="text-xs text-muted-foreground">{p.payer_name}, ИНН {p.payer_inn}</div>}</TableCell>
                      <TableCell className="max-w-xs truncate" title={p.purpose ?? ''}>{p.purpose}</TableCell>
                      <TableCell className="text-right">{fmtMoney(p.amount)}</TableCell>
                      <TableCell className="text-right">{left(p) > 0 ? <Badge variant="destructive">{fmtMoney(left(p))}</Badge> : '—'}</TableCell>
                      <TableCell className="text-right">{can('client_documents', 'update') && left(p) > 0 && <Button size="sm" variant="outline" onClick={() => openAlloc(p)}>Разнести</Button>}</TableCell>
                    </TableRow>
                  ))}
                  {!shown.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Платежей нет.</TableCell></TableRow>}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ввести оплату вручную</DialogTitle><DialogDescription>Если в назначении указан номер счёта или сумма совпадает с одним неоплаченным счётом, платёж разнесётся сам.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
              <SelectTrigger aria-label="Заказчик"><SelectValue placeholder="Заказчик" /></SelectTrigger>
              <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="grid grid-cols-3 gap-3">
              <div><Label htmlFor="p-date">Дата</Label><Input id="p-date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              <div><Label htmlFor="p-sum">Сумма</Label><Input id="p-sum" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              <div><Label htmlFor="p-num">№ платёжки</Label><Input id="p-num" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></div>
            </div>
            <div><Label htmlFor="p-purpose">Назначение</Label><Input id="p-purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="Оплата по счёту СЧ-2026/17" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setAdding(false)}>Отмена</Button><Button onClick={addPayment} disabled={busy || !form.amount}>Добавить</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!alloc} onOpenChange={(o) => !o && setAlloc(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Разнести платёж</DialogTitle><DialogDescription>{alloc && `Сумма ${fmtMoney(alloc.amount)}, не разнесено ${fmtMoney(left(alloc))}`}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            {!alloc?.client_id && (
              <Select value={allocClient} onValueChange={(v) => { setAllocClient(v); setInvoiceId(''); }}>
                <SelectTrigger aria-label="Заказчик"><SelectValue placeholder="Чей это платёж" /></SelectTrigger>
                <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Select value={invoiceId} onValueChange={(v) => { setInvoiceId(v); const i = invoices.find((x) => x.id === v); if (i && alloc) setAllocAmount(String(Math.min(i.outstanding, left(alloc)))); }} disabled={!allocClient}>
              <SelectTrigger aria-label="Счёт"><SelectValue placeholder="Счёт" /></SelectTrigger>
              <SelectContent>{invoices.map((i) => <SelectItem key={i.id} value={i.id}>№ {i.number} — осталось {fmtMoney(i.outstanding)}</SelectItem>)}</SelectContent>
            </Select>
            <div><Label htmlFor="a-sum">Сумма</Label><Input id="a-sum" inputMode="decimal" value={allocAmount} onChange={(e) => setAllocAmount(e.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setAlloc(null)}>Отмена</Button><Button onClick={doAlloc} disabled={busy || !allocClient}>Сохранить</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default PaymentsPage;
