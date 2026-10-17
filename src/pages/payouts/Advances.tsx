import React, { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { usePermissions } from '@/hooks/usePermissions';
import { db, rpc } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import { ADVANCE_STATUSES } from '@/lib/payoutMeta';
import PageMeta from '@/components/PageMeta';
import { Plus } from 'lucide-react';

interface Advance { id: string; worker_id: string; amount: number; remaining: number; status: string; requested_by_worker: boolean; note: string | null; created_at: string; reject_reason: string | null }

const Advances: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const { scope } = usePermissions();
  const [rows, setRows] = useState<Advance[]>([]);
  const [workers, setWorkers] = useState<{ user_id: string; full_name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [workerId, setWorkerId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [room, setRoom] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [a, w] = await Promise.all([
      db('worker_advances').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200),
      db('workers').select('user_id,full_name').eq('org_id', orgId).order('full_name'),
    ]);
    setRows(a.data ?? []); setWorkers(w.data ?? []);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!workerId) { setRoom(null); return; }
    rpc('advance_limit', { _worker_id: workerId }).then(({ data }: { data: { room: number }[] | null }) => setRoom(data?.[0] ? Number(data[0].room) : null));
  }, [workerId]);

  const name = (id: string) => workers.find((w) => w.user_id === id)?.full_name ?? '—';
  const canEdit = scope('payout_registries', 'update') === 'all';

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await rpc(fn, args);
    setBusy(false);
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return false; }
    toast({ title: ok });
    load();
    return true;
  };

  return (
    <AppLayout>
      <PageMeta title="Авансы" description="Запросы и выдача авансов исполнителям" />
      <div className="max-w-5xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Авансы</h1>
            <p className="text-muted-foreground">Аванс — до половины уже начисленного за месяц. Выдаётся реестром типа «аванс» и удерживается из следующей выплаты.</p>
          </div>
          {scope('payout_registries', 'create') === 'all' && <Button className="gap-2" onClick={() => setOpen(true)}><Plus className="w-4 h-4" /> Оформить аванс</Button>}
        </div>
        <Card><CardContent className="pt-6">
          <Table>
            <TableHeader><TableRow><TableHead>Исполнитель</TableHead><TableHead>Дата</TableHead><TableHead className="text-right">Сумма</TableHead><TableHead className="text-right">К удержанию</TableHead><TableHead>Статус</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{name(a.worker_id)}{a.requested_by_worker && <Badge variant="outline" className="ml-2">запрос исполнителя</Badge>}{a.note && <div className="text-xs text-muted-foreground">{a.note}</div>}</TableCell>
                  <TableCell>{fmtDate(a.created_at.slice(0, 10))}</TableCell>
                  <TableCell className="text-right">{fmtMoney(a.amount)}</TableCell>
                  <TableCell className="text-right">{a.status === 'issued' ? fmtMoney(a.remaining) : '—'}</TableCell>
                  <TableCell><Badge variant={a.status === 'rejected' ? 'destructive' : 'secondary'}>{ADVANCE_STATUSES[a.status]}</Badge>{a.reject_reason && <div className="text-xs">{a.reject_reason}</div>}</TableCell>
                  <TableCell className="text-right space-x-2 whitespace-nowrap">
                    {canEdit && a.status === 'requested' && <>
                      <Button size="sm" disabled={busy} onClick={() => run('decide_advance', { _id: a.id, _approve: true }, 'Аванс согласован')}>Согласовать</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => { const r = window.prompt('Причина отказа'); if (r) run('decide_advance', { _id: a.id, _approve: false, _reason: r }, 'Отказано'); }}>Отказать</Button>
                    </>}
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Авансов пока нет.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Оформить аванс</DialogTitle><DialogDescription>Решением менеджера. Аванс сразу согласован и ждёт включения в реестр типа «аванс».</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <Select value={workerId} onValueChange={setWorkerId}>
              <SelectTrigger aria-label="Исполнитель"><SelectValue placeholder="Исполнитель" /></SelectTrigger>
              <SelectContent>{workers.map((w) => <SelectItem key={w.user_id} value={w.user_id}>{w.full_name}</SelectItem>)}</SelectContent>
            </Select>
            {room !== null && <p className="text-sm text-muted-foreground">Доступно для аванса: {fmtMoney(room)}</p>}
            <div><Label htmlFor="adv-sum">Сумма, ₽</Label><Input id="adv-sum" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div><Label htmlFor="adv-note">Основание</Label><Input id="adv-note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
            <Button disabled={busy || !workerId || !amount} onClick={async () => { if (await run('create_advance', { _worker_id: workerId, _amount: Number(amount.replace(',', '.')), _note: note || null }, 'Аванс оформлен')) { setOpen(false); setAmount(''); } }}>Оформить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default Advances;
