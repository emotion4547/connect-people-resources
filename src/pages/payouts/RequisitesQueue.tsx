import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { usePermissions } from '@/hooks/usePermissions';
import { rpc } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { CHANNELS } from '@/lib/payoutMeta';
import PageMeta from '@/components/PageMeta';

interface Row { id: string; worker_id: string; worker_name: string; channel: string; masked: string; status: string; submitted_at: string; submitted_by_worker: boolean }

// Очередь реквизитов на подтверждение (В-13): пока заявка не рассмотрена, выплаты исполнителю приостановлены.
const RequisitesQueue: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const { scope } = usePermissions();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await rpc('payout_requisites_queue', { _org_id: orgId });
    if (error) { toast({ title: 'Не удалось загрузить', description: error.message, variant: 'destructive' }); return; }
    setRows(data ?? []);
  }, [orgId, toast]);

  useEffect(() => { load(); }, [load]);

  const decide = async (r: Row, approve: boolean) => {
    let reason: string | null = null;
    if (!approve) { reason = window.prompt('Причина отказа'); if (!reason) return; }
    setBusy(true);
    const { error } = await rpc('decide_payout_requisites', { _id: r.id, _approve: approve, _reason: reason });
    setBusy(false);
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return; }
    toast({ title: approve ? 'Реквизиты подтверждены' : 'Отклонено' });
    load();
  };

  const canDecide = scope('worker_payout_details', 'update') === 'all';
  const pending = rows.filter((r) => r.status === 'pending');

  return (
    <AppLayout>
      <PageMeta title="Реквизиты исполнителей" description="Подтверждение реквизитов выплат" />
      <div className="max-w-4xl mx-auto space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Реквизиты исполнителей</h1>
          <p className="text-muted-foreground">Новые реквизиты, присланные самим исполнителем, проверяет бухгалтер. До решения выплаты исполнителю приостановлены.</p>
        </div>
        <Card><CardContent className="pt-6">
          <Table>
            <TableHeader><TableRow><TableHead>Исполнитель</TableHead><TableHead>Способ</TableHead><TableHead>Реквизиты</TableHead><TableHead>Статус</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Link to={`/workers/${r.worker_id}`} className="font-medium hover:underline">{r.worker_name}</Link><div className="text-xs text-muted-foreground">от {fmtDate(r.submitted_at.slice(0, 10))}</div></TableCell>
                  <TableCell>{CHANNELS[r.channel]}</TableCell>
                  <TableCell>{r.masked}</TableCell>
                  <TableCell><Badge variant={r.status === 'pending' ? 'destructive' : 'secondary'}>{r.status === 'pending' ? 'ждёт подтверждения' : 'подтверждены'}</Badge></TableCell>
                  <TableCell className="text-right space-x-2 whitespace-nowrap">
                    {canDecide && r.status === 'pending' && <>
                      <Button size="sm" disabled={busy} onClick={() => decide(r, true)}>Подтвердить</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => decide(r, false)}>Отклонить</Button>
                    </>}
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Реквизитов пока нет.</TableCell></TableRow>}
            </TableBody>
          </Table>
          {pending.length === 0 && rows.length > 0 && <p className="text-sm text-muted-foreground mt-3">Заявок на подтверждение нет.</p>}
        </CardContent></Card>
      </div>
    </AppLayout>
  );
};

export default RequisitesQueue;
