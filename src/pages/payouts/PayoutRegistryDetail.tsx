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
import { db, invokeFunction, rpc } from '@/lib/db';
import { downloadCsv } from '@/lib/csv';
import { buildPaymentOrders, encodeCp1251, type PayLine } from '@/lib/bankFiles';
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
  const [picked, setPicked] = useState<string[]>([]);

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

  const exportRows = async (): Promise<PayLine[] | null> => {
    const { data, error } = await rpc('payout_registry_export', { _registry_id: id });
    if (error) { toast({ title: 'Выгрузка не получилась', description: error.message, variant: 'destructive' }); return null; }
    return (data as { worker_name: string; requisites: string | null; account: string | null; bik: string | null; amount: number; purpose: string; registry_number: string }[])
      .map((r) => ({ ...r, amount: Number(r.amount) }));
  };

  const downloadTable = async () => {
    const rows = await exportRows();
    if (!rows || !reg) return;
    downloadCsv(`reestr-${reg.number?.replace(/[^\w-]+/g, '_')}.csv`, ['Получатель', 'Реквизиты', 'Сумма', 'Назначение'], rows.map((r) => [r.worker_name, r.requisites, r.amount, r.purpose]));
  };

  const downloadBankFile = async () => {
    const rows = await exportRows();
    if (!rows || !reg) return;
    const { data: org } = await db('organizations').select('name,inn,kpp,bank_account,bank_name,bik').eq('id', reg.org_id).maybeSingle();
    if (!org?.bank_account || !org?.bik) { toast({ title: 'В карточке организации не заполнены расчётный счёт и БИК', variant: 'destructive' }); return; }
    const { text, skipped } = buildPaymentOrders(org, rows);
    const blob = new Blob([encodeCp1251(text)], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `1c_to_kl-${reg.number?.replace(/[^\w-]+/g, '_')}.txt`; a.click(); URL.revokeObjectURL(a.href);
    if (skipped.length) toast({ title: `Без номера счёта (карты): ${skipped.length}`, description: 'Эти выплаты передайте таблицей или картой в банке.' });
  };

  const sendPlatform = async () => {
    setBusy(true);
    const { data, error } = await invokeFunction('send-platform-payouts', { registry_id: id });
    setBusy(false);
    if (error || data?.error) { toast({ title: 'Платформа не приняла реестр', description: data?.error ?? error?.message, variant: 'destructive' }); return; }
    toast({ title: `Платформа ответила: проведено ${data.paid}, ошибок ${data.error}` });
    load();
  };

  const settle = async (status: 'paid' | 'error') => {
    let text: string | null = null;
    if (status === 'error') { text = window.prompt('Текст ошибки'); if (!text) return; }
    await run('settle_payout_lines', { _registry_id: id, _line_ids: picked, _status: status, _text: text }, status === 'paid' ? 'Отмечено проведёнными' : 'Отмечено ошибкой');
    setPicked([]);
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
        {canEdit && ['confirmed', 'sent', 'paid_partial', 'errors'].includes(reg.status) && (
          <Card><CardContent className="pt-6 space-y-3">
            <div className="flex flex-wrap gap-2">
              {reg.channel === 'bank' && <Button variant="outline" onClick={downloadBankFile}>Файл для банка (1С)</Button>}
              <Button variant="outline" onClick={downloadTable}>Таблица (Excel)</Button>
              {reg.status === 'confirmed' && <Button variant="outline" disabled={busy} onClick={() => run('mark_registry_sent', { _registry_id: reg.id }, 'Отмечен отправленным')}>Отметить отправленным</Button>}
              {reg.channel === 'platform' && <Button disabled={busy} onClick={sendPlatform}>Отправить на платформу</Button>}
            </div>
            <p className="text-xs text-muted-foreground">Ручной режим: выберите строки и отметьте результат. Банковские платежи отмечаются сами при загрузке выписки на странице «Оплаты».</p>
            {picked.length > 0 && (
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => settle('paid')}>Проведены: {picked.length}</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => settle('error')}>Ошибка</Button>
              </div>
            )}
          </CardContent></Card>
        )}
        <Card><CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" /><TableHead>Исполнитель</TableHead><TableHead className="text-right">Начислено</TableHead><TableHead className="text-right">Удержан аванс</TableHead>
                <TableHead className="text-right">НДФЛ (агент)</TableHead><TableHead className="text-right">К перечислению</TableHead><TableHead>Реквизиты</TableHead><TableHead>Статус</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{canEdit && l.status === 'pending' && ['confirmed', 'sent', 'paid_partial', 'errors'].includes(reg.status) && <input type="checkbox" aria-label="Выбрать строку" className="h-4 w-4" checked={picked.includes(l.id)} onChange={() => setPicked((x) => (x.includes(l.id) ? x.filter((i) => i !== l.id) : [...x, l.id]))} />}</TableCell>
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
              <TableRow><TableCell /><TableCell>Итого</TableCell><TableCell className="text-right">{fmtMoney(sum('gross'))}</TableCell><TableCell className="text-right">{fmtMoney(sum('advance_held'))}</TableCell>
                <TableCell className="text-right">{fmtMoney(sum('ndfl'))}</TableCell><TableCell className="text-right font-semibold">{fmtMoney(sum('amount_to_pay'))}</TableCell><TableCell colSpan={3} /></TableRow>
            </TableFooter>
          </Table>
        </CardContent></Card>
      </div>
    </AppLayout>
  );
};

export default PayoutRegistryDetail;
