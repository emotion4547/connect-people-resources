import React, { useCallback, useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { rpc } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { CHANNELS } from '@/lib/payoutMeta';
import PageMeta from '@/components/PageMeta';

interface Row { id: string; channel: string; masked: string; status: string; submitted_at: string; reject_reason: string | null }

const STATUS: Record<string, string> = { pending: 'Ждёт подтверждения', confirmed: 'Подтверждены', rejected: 'Отклонены' };

// Реквизиты выплат в кабинете исполнителя (И-5, В-13): новые реквизиты подтверждает бухгалтер.
const WorkerPayouts: React.FC = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [channel, setChannel] = useState('bank_card');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await rpc('my_payout_requisites', {});
    setRows(data ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const send = async () => {
    if (!user) return;
    setBusy(true);
    const { error } = await rpc('submit_payout_requisites', { _worker_id: user.id, _channel: channel, _details: details });
    setBusy(false);
    if (error) { toast({ title: 'Не отправлено', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Реквизиты отправлены на проверку', description: 'Выплаты возобновятся после подтверждения бухгалтером.' });
    setDetails('');
    load();
  };

  return (
    <DashboardLayout role="worker">
      <PageMeta title="Реквизиты выплат" description="Куда перечислять заработок" />
      <div className="max-w-2xl mx-auto space-y-4 animate-slide-up">
        <h1 className="text-2xl font-bold">Реквизиты выплат</h1>
        {rows.map((r) => (
          <Card key={r.id}>
            <CardContent className="pt-4 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{CHANNELS[r.channel]}: {r.masked}</span>
                <Badge variant={r.status === 'confirmed' ? 'default' : r.status === 'rejected' ? 'destructive' : 'secondary'}>{STATUS[r.status]}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">от {fmtDate(r.submitted_at.slice(0, 10))}</p>
              {r.reject_reason && <p className="text-sm text-destructive">Причина отказа: {r.reject_reason}</p>}
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{rows.length ? 'Изменить реквизиты' : 'Добавить реквизиты'}</CardTitle>
            <CardDescription>Новые реквизиты проверяет бухгалтер. Пока они не подтверждены, выплаты приостанавливаются — так мы защищаем вас от подмены карты.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger aria-label="Способ"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(CHANNELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
            <div><Label htmlFor="req">Номер карты, счёта или телефон</Label><Input id="req" value={details} onChange={(e) => setDetails(e.target.value)} /></div>
            <Button className="w-full min-h-11" disabled={busy || details.trim().length < 6} onClick={send}>Отправить на проверку</Button>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default WorkerPayouts;
