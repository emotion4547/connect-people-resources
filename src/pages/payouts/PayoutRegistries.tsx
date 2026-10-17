import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { usePermissions } from '@/hooks/usePermissions';
import { db, rpc } from '@/lib/db';
import { fmtDate, fmtMoney, monthEnd, monthStart } from '@/lib/format';
import { REGISTRY_CHANNELS, REGISTRY_KINDS, REGISTRY_STATUSES, type Exclusion, type Registry } from '@/lib/payoutMeta';
import PageMeta from '@/components/PageMeta';

const PayoutRegistries: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const { can } = usePermissions();
  const [rows, setRows] = useState<Registry[]>([]);
  const [excl, setExcl] = useState<Exclusion[]>([]);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [kind, setKind] = useState('payment');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    const [r, e] = await Promise.all([
      db('payout_registries').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(100),
      db('payout_exclusions').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(50),
    ]);
    if (r.error) toast({ title: 'Не удалось загрузить реестры', description: r.error.message, variant: 'destructive' });
    setRows(r.data ?? []); setExcl(e.data ?? []);
  }, [orgId, toast]);

  useEffect(() => { load(); }, [load]);

  const build = async () => {
    if (!orgId) return;
    setBusy(true);
    const { data, error } = await rpc('build_payout_registries', { _org_id: orgId, _from: from, _to: to, _kind: kind });
    setBusy(false);
    if (error) { toast({ title: 'Реестр не собран', description: error.message, variant: 'destructive' }); return; }
    const n = data.registries.length;
    toast({ title: n ? `Собрано реестров: ${n}` : 'Выплачивать нечего', description: data.excluded ? `Не включено исполнителей: ${data.excluded} — см. список ниже` : undefined });
    load();
  };

  return (
    <AppLayout>
      <PageMeta title="Реестры выплат" description="Сборка и подтверждение выплат исполнителям" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Реестры выплат</h1>
          <p className="text-muted-foreground">Реестр делится по каналам сам. Подтверждает его не тот, кто составил. После подтверждения состав и суммы не меняются.</p>
        </div>
        {can('payout_registries', 'create') && (
          <Card>
            <CardContent className="pt-6 flex flex-wrap items-end gap-4">
              <div><Label htmlFor="r-from">С</Label><Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label htmlFor="r-to">По</Label><Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="w-40" aria-label="Тип"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(REGISTRY_KINDS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
              <Button disabled={busy} onClick={build}>Собрать реестр</Button>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow><TableHead>Реестр</TableHead><TableHead>Канал</TableHead><TableHead>Период</TableHead><TableHead className="text-right">Строк</TableHead><TableHead className="text-right">Сумма</TableHead><TableHead>Статус</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><Link to={`/payout-registries/${r.id}`} className="font-medium hover:underline">{r.number}</Link><div className="text-xs text-muted-foreground">{REGISTRY_KINDS[r.kind]}</div></TableCell>
                    <TableCell>{REGISTRY_CHANNELS[r.channel]}</TableCell>
                    <TableCell>{fmtDate(r.period_from)} — {fmtDate(r.period_to)}</TableCell>
                    <TableCell className="text-right">{r.lines_count}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.total_amount)}</TableCell>
                    <TableCell><Badge variant={r.status === 'errors' ? 'destructive' : r.status === 'cancelled' ? 'outline' : 'secondary'}>{REGISTRY_STATUSES[r.status]}</Badge></TableCell>
                  </TableRow>
                ))}
                {!rows.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Реестров пока нет.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        {excl.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">Не включены в реестры</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Исполнитель</TableHead><TableHead className="text-right">Сумма</TableHead><TableHead>Причины</TableHead></TableRow></TableHeader>
                <TableBody>
                  {excl.map((x) => (
                    <TableRow key={x.id}>
                      <TableCell><Link to={`/workers/${x.worker_id}`} className="hover:underline">{x.worker_name}</Link></TableCell>
                      <TableCell className="text-right">{fmtMoney(x.amount)}</TableCell>
                      <TableCell className="text-sm">{x.reasons.map((r) => <div key={r}>• {r}</div>)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
};

export default PayoutRegistries;
