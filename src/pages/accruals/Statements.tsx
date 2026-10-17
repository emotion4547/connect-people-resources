import React, { useCallback, useEffect, useState } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import { db, rpc } from '@/lib/db';
import { downloadCsv } from '@/lib/csv';
import { fmtDate, fmtMoney, monthEnd, monthStart } from '@/lib/format';
import PageMeta from '@/components/PageMeta';
import { Download } from 'lucide-react';

interface WorkerRow {
  worker_id: string; worker_name: string; tax_status: string | null; shifts: number; hours: number; accrued: number;
  bonuses: number; deductions: number; corrections: number; to_pay: number; taxes: number; payout_fee: number;
}
interface ClientRow {
  client_id: string; client_name: string; site_id: string; site_name: string; hours: number; to_invoice: number;
  payout: number; taxes_and_fees: number; cost: number; margin: number; margin_pct: number | null;
}
interface Pending {
  id: string; worker_id: string; shift_date: string; amount_worker: number; note: string | null;
}

const TAX: Record<string, string> = { ip: 'ИП', self_employed: 'Самозанятый', gph: 'ГПХ', employment: 'Трудовой' };
const n = (v: number) => Number(v ?? 0);

const Statements: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const { role } = useAuth();
  const { can } = usePermissions();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [tab, setTab] = useState<'workers' | 'clients'>('workers');
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [w, c, p, ws] = await Promise.all([
      rpc('worker_statement', { _from: from, _to: to }),
      rpc('client_statement', { _from: from, _to: to }),
      db('accruals').select('id,worker_id,shift_date,amount_worker,note').eq('org_id', orgId).eq('needs_approval', true).eq('status', 'draft'),
      db('workers').select('user_id,full_name').eq('org_id', orgId),
    ]);
    setLoading(false);
    if (w.error || c.error) { toast({ title: 'Не удалось загрузить ведомости', description: (w.error ?? c.error).message, variant: 'destructive' }); return; }
    setWorkers(w.data ?? []); setClients(c.data ?? []); setPending(p.data ?? []);
    setNames(Object.fromEntries((ws.data ?? []).map((x: { user_id: string; full_name: string }) => [x.user_id, x.full_name])));
  }, [orgId, from, to, toast]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, approve: boolean) => {
    const { error } = await rpc('approve_accrual', { _accrual_id: id, _approve: approve });
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return; }
    toast({ title: approve ? 'Удержание согласовано' : 'Удержание отклонено' });
    load();
  };

  const exportWorkers = () => downloadCsv(`vedomost-ispolniteli-${from}-${to}.csv`,
    ['Исполнитель', 'Налоговый статус', 'Смен', 'Часов', 'Начислено', 'Бонусы', 'Удержания', 'Корректировки', 'К выплате', 'Налоги и взносы', 'Комиссия выплаты'],
    workers.map((r) => [r.worker_name, r.tax_status ? TAX[r.tax_status] : '', r.shifts, n(r.hours), n(r.accrued), n(r.bonuses), n(r.deductions), n(r.corrections), n(r.to_pay), n(r.taxes), n(r.payout_fee)]));
  const exportClients = () => downloadCsv(`vedomost-zakazchiki-${from}-${to}.csv`,
    ['Заказчик', 'Объект', 'Часов', 'К выставлению', 'К выплате', 'Налоги и комиссии', 'Себестоимость', 'Маржа', 'Маржа, %'],
    clients.map((r) => [r.client_name, r.site_name, n(r.hours), n(r.to_invoice), n(r.payout), n(r.taxes_and_fees), n(r.cost), n(r.margin), r.margin_pct]));

  const totalInvoice = clients.reduce((s, r) => s + n(r.to_invoice), 0);
  const totalMargin = clients.reduce((s, r) => s + n(r.margin), 0);
  const canApprove = role === 'director' || role === 'admin';

  return (
    <AppLayout>
      <PageMeta title="Начисления и маржа" description="Ведомости по исполнителям и заказчикам" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Начисления и маржа</h1>
          <p className="text-muted-foreground">Деньги считаются по подтверждённым строкам табеля. Акты и выплаты — на втором этапе.</p>
        </div>

        {can('accruals', 'view') && pending.length > 0 && (
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-base">Удержания на согласовании ({pending.length})</CardTitle>
              <CardDescription>Удержание больше порога от начисления за смену согласует руководитель.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {pending.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{names[p.worker_id] ?? '—'}</TableCell>
                      <TableCell>{fmtDate(p.shift_date)}</TableCell>
                      <TableCell>{fmtMoney(p.amount_worker)}</TableCell>
                      <TableCell className="text-muted-foreground">{p.note}</TableCell>
                      <TableCell className="text-right space-x-2 whitespace-nowrap">
                        {canApprove ? (<>
                          <Button size="sm" onClick={() => decide(p.id, true)}>Согласовать</Button>
                          <Button size="sm" variant="outline" onClick={() => decide(p.id, false)}>Отклонить</Button>
                        </>) : <Badge variant="secondary">ждёт руководителя</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div><Label htmlFor="st-from">С</Label><Input id="st-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label htmlFor="st-to">По</Label><Input id="st-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              <Tabs value={tab} onValueChange={(v) => setTab(v as 'workers' | 'clients')}>
                <TabsList>
                  <TabsTrigger value="workers">Исполнители</TabsTrigger>
                  <TabsTrigger value="clients">Заказчики и объекты</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button variant="outline" className="gap-2 ml-auto" onClick={tab === 'workers' ? exportWorkers : exportClients} disabled={loading}>
                <Download className="w-4 h-4" /> В Excel (CSV)
              </Button>
            </div>

            {loading ? <p className="text-muted-foreground">Загрузка…</p> : tab === 'workers' ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Исполнитель</TableHead><TableHead>Статус</TableHead><TableHead className="text-right">Смен</TableHead><TableHead className="text-right">Часов</TableHead>
                    <TableHead className="text-right">Начислено</TableHead><TableHead className="text-right">Бонусы</TableHead><TableHead className="text-right">Удержания</TableHead>
                    <TableHead className="text-right">Корректировки</TableHead><TableHead className="text-right">К выплате</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workers.map((r) => (
                    <TableRow key={r.worker_id}>
                      <TableCell>{r.worker_name}</TableCell>
                      <TableCell>{r.tax_status ? TAX[r.tax_status] : '—'}</TableCell>
                      <TableCell className="text-right">{r.shifts}</TableCell>
                      <TableCell className="text-right">{n(r.hours)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.accrued)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.bonuses)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.deductions)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(r.corrections)}</TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(r.to_pay)}</TableCell>
                    </TableRow>
                  ))}
                  {!workers.length && <TableRow><TableCell colSpan={9} className="text-muted-foreground">Начислений за период нет.</TableCell></TableRow>}
                </TableBody>
              </Table>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Заказчик</TableHead><TableHead>Объект</TableHead><TableHead className="text-right">Часов</TableHead>
                      <TableHead className="text-right">К выставлению</TableHead><TableHead className="text-right">К выплате</TableHead>
                      <TableHead className="text-right">Налоги и комиссии</TableHead><TableHead className="text-right">Маржа</TableHead><TableHead className="text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clients.map((r) => (
                      <TableRow key={`${r.client_id}-${r.site_id}`}>
                        <TableCell>{r.client_name}</TableCell>
                        <TableCell>{r.site_name}</TableCell>
                        <TableCell className="text-right">{n(r.hours)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(r.to_invoice)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(r.payout)}</TableCell>
                        <TableCell className="text-right">{fmtMoney(r.taxes_and_fees)}</TableCell>
                        <TableCell className="text-right font-medium">{fmtMoney(r.margin)}</TableCell>
                        <TableCell className="text-right">{r.margin_pct ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                    {!clients.length && <TableRow><TableCell colSpan={8} className="text-muted-foreground">Начислений за период нет.</TableCell></TableRow>}
                  </TableBody>
                </Table>
                {clients.length > 0 && <p className="text-sm text-muted-foreground">Итого: к выставлению {fmtMoney(totalInvoice)}, маржа {fmtMoney(totalMargin)}.</p>}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Statements;
