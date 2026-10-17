import React, { useCallback, useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db, rpc } from '@/lib/db';
import { addDays, fmtMoney, today } from '@/lib/format';
import { MY_STATUS, dateLong, mapsLink, timeIn, type MyShift } from '@/lib/cabinetMeta';
import { QrScanDialog } from '@/components/worker/QrScanDialog';
import PageMeta from '@/components/PageMeta';
import { MapPin, Navigation, WifiOff } from 'lucide-react';

type Pos = { lat: number | null; lon: number | null; accuracy: number | null };

const getPosition = (): Promise<Pos> =>
  new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: null, lon: null, accuracy: null });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve({ lat: null, lon: null, accuracy: null }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

const WorkerShifts: React.FC = () => {
  const { toast } = useToast();
  const [rows, setRows] = useState<MyShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [qrFor, setQrFor] = useState<{ shift: MyShift; kind: 'in' | 'out' } | null>(null);
  const [cancelFor, setCancelFor] = useState<MyShift | null>(null);
  const [reasons, setReasons] = useState<{ id: string; name: string }[]>([]);
  const [reasonId, setReasonId] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await rpc('worker_my_shifts', { _from: today(), _to: addDays(today(), 30) });
    setLoading(false);
    if (error) { toast({ title: 'Не удалось загрузить смены', description: error.message, variant: 'destructive' }); return; }
    setRows(data ?? []);
  }, [toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  useEffect(() => {
    db('directories').select('id,name').eq('kind', 'cancel_reason').eq('is_active', true).order('sort_order')
      .then(({ data }: { data: { id: string; name: string }[] | null }) => setReasons(data ?? []));
  }, []);

  const act = async (key: string, fn: () => Promise<{ error: { message: string } | null }>, ok: string) => {
    setBusy(key);
    const { error } = await fn();
    setBusy(null);
    if (error) { toast({ title: 'Не получилось', description: error.message, variant: 'destructive' }); return false; }
    toast({ title: ok });
    await load();
    return true;
  };

  const mark = async (s: MyShift, kind: 'in' | 'out', qr?: string) => {
    const pos = s.checkin_method === 'qr' ? { lat: null, lon: null, accuracy: null } : await getPosition();
    await act(s.assignment_id + kind, () => rpc(kind === 'in' ? 'check_in' : 'check_out',
      { _assignment_id: s.assignment_id, _lat: pos.lat, _lon: pos.lon, _accuracy: pos.accuracy, _qr: qr ?? null }),
      kind === 'in' ? 'Вы отмечены на месте' : 'Смена окончена');
  };

  const press = (s: MyShift, kind: 'in' | 'out') => {
    if (!online) { toast({ title: 'Нет интернета', description: 'Отметка не поставится. Сообщите бригадиру или менеджеру, что вы на месте.', variant: 'destructive' }); return; }
    if (s.checkin_method === 'qr' || s.checkin_method === 'both') setQrFor({ shift: s, kind });
    else mark(s, kind);
  };

  const next = rows.find((r) => ['assigned', 'confirmed', 'on_site'].includes(r.status) && new Date(r.end_at) > new Date());

  const Card1: React.FC<{ s: MyShift; big?: boolean }> = ({ s, big }) => (
    <Card className={big ? 'border-primary' : ''}>
      <CardContent className="pt-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-semibold text-lg">{dateLong(s.shift_date)}, {timeIn(s.start_at, s.timezone)}–{timeIn(s.end_at, s.timezone)}</div>
            <div className="text-sm text-muted-foreground">{s.site_name} · {s.position_name}</div>
          </div>
          <Badge variant={s.status === 'invited' ? 'default' : 'secondary'}>{MY_STATUS[s.status] ?? s.status}{s.is_reserve ? ' (резерв)' : ''}</Badge>
        </div>
        {s.address && (
          <div className="flex items-start gap-2 text-sm"><MapPin className="w-4 h-4 mt-0.5 shrink-0" /><span>{s.address}</span></div>
        )}
        {s.instructions && <p className="text-sm">{s.instructions}</p>}
        {s.worker_rate !== null && (
          <p className="text-sm text-muted-foreground">Ставка {fmtMoney(s.worker_rate)}/ч · ориентировочно за смену {fmtMoney(s.est_earnings)}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="min-h-11 gap-2">
            <a href={mapsLink(s.latitude, s.longitude, s.address)} target="_blank" rel="noreferrer"><Navigation className="w-4 h-4" /> Как добраться</a>
          </Button>
          {s.status === 'invited' && (<>
            <Button className="min-h-11" disabled={!!busy} onClick={() => act(s.assignment_id, () => rpc('accept_invitation', { _assignment_id: s.assignment_id }), 'Вы назначены на смену')}>Принять</Button>
            <Button variant="outline" className="min-h-11" disabled={!!busy} onClick={() => act(s.assignment_id, () => rpc('decline_invitation', { _assignment_id: s.assignment_id }), 'Приглашение отклонено')}>Отклонить</Button>
          </>)}
          {s.status === 'assigned' && (
            <Button className="min-h-11" disabled={!!busy} onClick={() => act(s.assignment_id, () => rpc('confirm_assignment', { _assignment_id: s.assignment_id }), 'Выход подтверждён')}>Выйду</Button>
          )}
          {s.can_check_in && <Button className="min-h-11" disabled={!!busy} onClick={() => press(s, 'in')}>Я на месте</Button>}
          {s.status === 'on_site' && <Button className="min-h-11" disabled={!!busy} onClick={() => press(s, 'out')}>Смена окончена</Button>}
          {['assigned', 'confirmed'].includes(s.status) && !s.is_reserve && (
            <Button variant="ghost" className="min-h-11" onClick={() => { setCancelFor(s); setReasonId(''); }}>Не смогу</Button>
          )}
        </div>
        {s.status === 'worked' && s.approved_hours !== null && <p className="text-sm">Часы к оплате: {s.approved_hours}</p>}
      </CardContent>
    </Card>
  );

  return (
    <DashboardLayout role="worker">
      <PageMeta title="Мои смены" description="Ближайшие смены и отметки" />
      <div className="max-w-2xl mx-auto space-y-4 animate-slide-up">
        <h1 className="text-2xl font-bold">Мои смены</h1>
        {!online && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm"><WifiOff className="w-4 h-4" /> Нет интернета: отметку поставить нельзя. Сообщите бригадиру или менеджеру.</div>
        )}
        {loading ? <p className="text-muted-foreground">Загрузка…</p> : (<>
          {next && <><h2 className="font-semibold">Ближайшая</h2><Card1 s={next} big /></>}
          <h2 className="font-semibold pt-2">Все на ближайшие 30 дней</h2>
          {rows.filter((r) => r !== next).map((s) => <Card1 key={s.assignment_id} s={s} />)}
          {!rows.length && <p className="text-muted-foreground">Смен пока нет. Откройте «Открытые смены» и откликнитесь.</p>}
        </>)}
      </div>

      <QrScanDialog open={!!qrFor} onClose={() => setQrFor(null)} onCode={(code) => { const q = qrFor; setQrFor(null); if (q) mark(q.shift, q.kind, code); }} />

      <Dialog open={!!cancelFor} onOpenChange={(o) => !o && setCancelFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Не смогу выйти</DialogTitle>
            <DialogDescription>
              {cancelFor?.can_cancel_free ? 'Отмена без последствий.' : 'Время бесплатной отмены прошло: отмена будет считаться поздней, обратитесь к менеджеру.'}
            </DialogDescription>
          </DialogHeader>
          <Select value={reasonId} onValueChange={setReasonId}>
            <SelectTrigger aria-label="Причина"><SelectValue placeholder="Причина" /></SelectTrigger>
            <SelectContent>{reasons.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelFor(null)}>Назад</Button>
            <Button disabled={!reasonId || !!busy || !cancelFor?.can_cancel_free}
              onClick={async () => { if (cancelFor && await act(cancelFor.assignment_id, () => rpc('cancel_assignment', { _assignment_id: cancelFor.assignment_id, _reason_id: reasonId }), 'Смена отменена')) setCancelFor(null); }}>
              Отменить смену
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default WorkerShifts;
