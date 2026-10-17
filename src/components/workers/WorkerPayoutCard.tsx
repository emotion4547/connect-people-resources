import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { db, invokeFunction, rpc } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { CHANNELS, NPD_STATUSES } from '@/lib/payoutMeta';

interface Worker {
  user_id: string; tax_status: string | null; payout_stop: boolean; payout_stop_reason: string | null; employment_ended_on: string | null;
  npd_status: string; npd_checked_at: string | null; npd_message: string | null;
}
interface Requisite { id: string; channel: string; masked: string; status: string; submitted_at: string }

// Выплаты исполнителю: допуск, реквизиты, статус самозанятого, стоп выплат (ТЗ, раздел 15).
export const WorkerPayoutCard: React.FC<{ workerId: string; canEdit: boolean }> = ({ workerId, canEdit }) => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const [w, setW] = useState<Worker | null>(null);
  const [elig, setElig] = useState<{ eligible: boolean; channel: string; reasons: string[] } | null>(null);
  const [reqs, setReqs] = useState<Requisite[]>([]);
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState('bank_account');
  const [details, setDetails] = useState('');
  const [stopReason, setStopReason] = useState('');
  const [endDate, setEndDate] = useState('');

  const load = useCallback(async () => {
    if (!orgId) return;
    const [a, e, q] = await Promise.all([
      db('workers').select('user_id,tax_status,payout_stop,payout_stop_reason,employment_ended_on,npd_status,npd_checked_at,npd_message').eq('user_id', workerId).maybeSingle(),
      rpc('payout_eligibility', { _worker_id: workerId }),
      rpc('payout_requisites_queue', { _org_id: orgId }),
    ]);
    setW(a.data); setEndDate(a.data?.employment_ended_on ?? '');
    setElig(e.data?.[0] ?? null);
    setReqs(((q.data ?? []) as (Requisite & { worker_id: string })[]).filter((r) => r.worker_id === workerId));
  }, [orgId, workerId]);

  useEffect(() => { load(); }, [load]);

  const run = async (p: Promise<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true);
    const { error } = await p;
    setBusy(false);
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return false; }
    toast({ title: ok });
    await load();
    return true;
  };

  const checkNpd = async () => {
    if (!orgId) return;
    setBusy(true);
    const { error } = await invokeFunction('check-npd-status', { org_id: orgId, worker_ids: [workerId] });
    setBusy(false);
    if (error) { toast({ title: 'Проверка не удалась', description: error.message, variant: 'destructive' }); return; }
    await load();
  };

  if (!w) return null;
  const confirmed = reqs.find((r) => r.status === 'confirmed');
  const pending = reqs.find((r) => r.status === 'pending');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Выплаты</CardTitle>
        <CardDescription>Допуск к реестру выплат и защита от рисков.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {elig && (
          <div className="space-y-1">
            <Badge variant={elig.eligible ? 'default' : 'destructive'}>{elig.eligible ? `Допущен к выплате (${elig.channel === 'platform' ? 'платформа самозанятых' : 'банк'})` : 'Не допущен'}</Badge>
            {elig.reasons.map((r) => <p key={r} className="text-destructive">• {r}</p>)}
          </div>
        )}

        <div>
          <div className="font-medium">Реквизиты</div>
          {confirmed ? <p>{CHANNELS[confirmed.channel]}: {confirmed.masked} <Badge variant="outline">подтверждены</Badge></p> : <p className="text-muted-foreground">Подтверждённых реквизитов нет.</p>}
          {pending && (
            <div className="rounded-md border p-3 mt-2 space-y-2">
              <p>Новые реквизиты ждут подтверждения: {CHANNELS[pending.channel]}, {pending.masked} (от {fmtDate(pending.submitted_at.slice(0, 10))})</p>
              {canEdit && <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => run(rpc('decide_payout_requisites', { _id: pending.id, _approve: true }), 'Реквизиты подтверждены')}>Подтвердить</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => { const r = window.prompt('Причина отказа'); if (r) run(rpc('decide_payout_requisites', { _id: pending.id, _approve: false, _reason: r }), 'Отклонено'); }}>Отклонить</Button>
              </div>}
            </div>
          )}
          {canEdit && (
            <div className="grid gap-2 sm:grid-cols-[180px_1fr_auto] mt-3">
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger aria-label="Способ"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CHANNELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
              <Input value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Номер счёта, карты или телефон платформы" aria-label="Реквизиты" />
              <Button variant="outline" disabled={busy || details.trim().length < 6}
                onClick={async () => { if (await run(rpc('submit_payout_requisites', { _worker_id: workerId, _channel: channel, _details: details }), 'Реквизиты внесены')) setDetails(''); }}>Внести</Button>
            </div>
          )}
        </div>

        {w.tax_status === 'self_employed' && (
          <div>
            <div className="font-medium">Статус самозанятого в ФНС</div>
            <p>
              {NPD_STATUSES[w.npd_status]}{w.npd_checked_at && `, проверено ${fmtDate(w.npd_checked_at.slice(0, 10))}`}{w.npd_message ? ` — ${w.npd_message}` : ''}
            </p>
            {canEdit && <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={checkNpd}>Проверить сейчас</Button>}
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] items-end">
              <div><Label htmlFor="emp-end">Уволен по трудовому договору (дата)</Label><Input id="emp-end" type="date" value={endDate} disabled={!canEdit} onChange={(e) => setEndDate(e.target.value)} /></div>
              {canEdit && <Button variant="outline" disabled={busy} onClick={() => run(rpc('set_employment_end', { _worker_id: workerId, _date: endDate || null }), 'Дата сохранена')}>Сохранить</Button>}
            </div>
          </div>
        )}

        <div>
          <div className="font-medium">Стоп выплат</div>
          {w.payout_stop ? (
            <div className="space-y-2">
              <p className="text-destructive">Выплаты остановлены: {w.payout_stop_reason}</p>
              {canEdit && <Button size="sm" variant="outline" disabled={busy} onClick={() => run(rpc('set_payout_stop', { _worker_id: workerId, _stop: false }), 'Выплаты разрешены')}>Снять стоп</Button>}
            </div>
          ) : canEdit ? (
            <div className="flex gap-2">
              <Textarea rows={1} value={stopReason} onChange={(e) => setStopReason(e.target.value)} placeholder="Причина остановки выплат" />
              <Button variant="outline" disabled={busy || !stopReason.trim()} onClick={async () => { if (await run(rpc('set_payout_stop', { _worker_id: workerId, _stop: true, _reason: stopReason }), 'Выплаты остановлены')) setStopReason(''); }}>Остановить</Button>
            </div>
          ) : <p className="text-muted-foreground">Нет.</p>}
        </div>
      </CardContent>
    </Card>
  );
};
