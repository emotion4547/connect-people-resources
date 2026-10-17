import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { db, rpc } from '@/lib/db';
import { fmtDate, fmtMoney } from '@/lib/format';
import { LINE_STATUSES, REGISTRY_CHANNELS, REGISTRY_KINDS, REGISTRY_STATUSES, type Registry, type RegistryLine } from '@/lib/payoutMeta';
import PageMeta from '@/components/PageMeta';
import { ArrowLeft } from 'lucide-react';

const PayoutRegistryDetail: React.FC = () => {
  const { id } = useParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const { scope } = usePermissions();
  const [reg, setReg] = useState<Registry | null>(null);
  const [lines, setLines] = useState<RegistryLine[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r, l] = await Promise.all([db('payout_registries').select('*').eq('id', id).maybeSingle(), rpc('payout_registry_lines', { _registry_id: id })]);
    if (r.error || !r.data) { toast({ title: 'Реестр не найден', description: r.error?.message, variant: 'destructive' }); return; }
    setReg(r.data); setLines(l.data ?? []);
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const { error } = await rpc(fn, args);
    setBusy(false);
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return; }
    toast({ title: ok });
    load();
  };

  if (!reg) return <AppLayout><p className="text-muted-foreground">Загрузка…</p></AppLayout>;
  const canEdit = scope('payout_registries', 'update') === 'all';
  const own = reg.created_by === user?.id;
  const sum = (k: keyof RegistryLine) => lines.filter((l) => l.status !== 'cancelled').reduce((s, l) => s + Number(l[k] ?? 0), 0);

  return (
    <AppLayout>
      <PageMeta title={`Реестр ${reg.number}`} description="Строки реестра выплат" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <Link to="/payout-registries" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:underline"><ArrowLeft className="w-4 h-4" /> Все реестры</Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{reg.number}</h1>
            <p className="text-muted-foreground">{REGISTRY_KINDS[reg.kind]} · {REGISTRY_CHANNELS[reg.channel]} · {fmtDate(reg.period_from)} — {fmtDate(reg.period_to)}</p>
          </div>
          <Badge variant={reg.status === 'errors' ? 'destructive' : 'secondary'}>{REGISTRY_STATUSES[reg.status]}</Badge>
        </div>
        {reg.cancel_reason && <p className="rounded-md border p-3 text-sm">Аннулирован: {reg.cancel_reason}</p>}
        {canEdit && reg.status === 'composed' && (
          <Card className="border-primary"><CardContent className="pt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">{own ? 'Реестр составили вы: подтвердить его должен другой сотрудник (главный бухгалтер или руководитель).' : 'Проверьте строки и подтвердите реестр.'}</p>
            <Button disabled={busy || own} onClick={() => run('confirm_payout_registry', { _id: reg.id }, 'Реестр подтверждён')}>Подтвердить</Button>
          </CardContent></Card>
        )}
        {canEdit && ['composed', 'confirmed'].includes(reg.status) && (
          <Button variant="outline" disabled={busy} onClick={() => { const r = window.prompt('Причина аннулирования'); if (r) run('cancel_payout_registry', { _id: reg.id, _reason: r }, 'Реестр аннулирован'); }}>Аннулировать реестр</Button>
        )}
        <Card><CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Исполнитель</TableHead><TableHead className="text-right">Начислено</TableHead><TableHead className="text-right">Удержан аванс</TableHead>
                <TableHead className="text-right">НДФЛ (агент)</TableHead><TableHead className="text-right">К перечислению</TableHead><TableHead>Реквизиты</TableHead><TableHead>Статус</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell><Link to={`/workers/${l.worker_id}`} className="hover:underline">{l.worker_name}</Link></TableCell>
                  <TableCell className="text-right">{fmtMoney(l.gross)}</TableCell>
                  <TableCell className="text-right">{Number(l.advance_held) ? fmtMoney(l.advance_held) : '—'}</TableCell>
                  <TableCell className="text-right">{Number(l.ndfl) ? fmtMoney(l.ndfl) : '—'}</TableCell>
                  <TableCell className="text-right font-medium">{fmtMoney(l.amount_to_pay)}</TableCell>
                  <TableCell>{l.requisites_masked}</TableCell>
                  <TableCell>
                    <Badge variant={l.status === 'error' ? 'destructive' : 'secondary'}>{LINE_STATUSES[l.status]}</Badge>
                    {l.error_text && <div className="text-xs text-destructive">{l.error_text}</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit && reg.status === 'composed' && l.status === 'pending' && (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const r = window.prompt('Причина исключения из реестра'); if (r) run('remove_payout_line', { _line_id: l.id, _reason: r }, 'Строка убрана'); }}>Убрать</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow><TableCell>Итого</TableCell><TableCell className="text-right">{fmtMoney(sum('gross'))}</TableCell><TableCell className="text-right">{fmtMoney(sum('advance_held'))}</TableCell>
                <TableCell className="text-right">{fmtMoney(sum('ndfl'))}</TableCell><TableCell className="text-right font-semibold">{fmtMoney(sum('amount_to_pay'))}</TableCell><TableCell colSpan={3} /></TableRow>
            </TableFooter>
          </Table>
        </CardContent></Card>
      </div>
    </AppLayout>
  );
};

export default PayoutRegistryDetail;
