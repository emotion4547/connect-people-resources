import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { db, rpc } from '@/lib/db';
import { addDays, fmtMoney, today } from '@/lib/format';
import { WEEKDAYS, hhmm, type Order } from '@/lib/ordersMeta';
import { type ClientTariff } from '@/lib/cabinetMeta';
import PageMeta from '@/components/PageMeta';

interface Site { org_id: string; id: string; name: string; client_id: string }

// ISO-день недели: 1 — понедельник … 7 — воскресенье.
const isoDow = (iso: string) => ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

const ClientOrder: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tariffs, setTariffs] = useState<ClientTariff[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [recent, setRecent] = useState<Order[]>([]);
  const [siteId, setSiteId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [from, setFrom] = useState(addDays(today(), 1));
  const [to, setTo] = useState(addDays(today(), 1));
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [start, setStart] = useState('08:00');
  const [end, setEnd] = useState('17:00');
  const [brk, setBrk] = useState('60');
  const [headcount, setHeadcount] = useState('1');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<{ key: string; amount: number | null; error: string } | null>(null);

  useEffect(() => {
    (async () => {
      const [t, s, o] = await Promise.all([
        rpc('client_tariffs'),
        db('sites').select('id,name,client_id,org_id').eq('status', 'active'),
        db('orders').select('*').order('created_at', { ascending: false }).limit(10),
      ]);
      setTariffs(t.data ?? []); setSites(s.data ?? []); setRecent(o.data ?? []);
    })();
  }, []);

  // Объект доступен, если на него или на все объекты заказчика есть тариф.
  const siteOptions = useMemo(() => sites.filter((s) => tariffs.some((t) => t.client_id === s.client_id && (t.site_id === null || t.site_id === s.id))), [sites, tariffs]);
  const site = sites.find((s) => s.id === siteId);
  const positionOptions = useMemo(() => {
    if (!site) return [];
    const m = new Map<string, ClientTariff>();
    // Тариф на конкретный объект важнее общего.
    tariffs.filter((t) => t.client_id === site.client_id && (t.site_id === null || t.site_id === site.id))
      .sort((a, b) => Number(a.site_id !== null) - Number(b.site_id !== null))
      .forEach((t) => m.set(t.position_id, t));
    return Array.from(m.values());
  }, [site, tariffs]);
  const tariff = positionOptions.find((t) => t.position_id === positionId);

  const days = useMemo(() => {
    const out: string[] = [];
    for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) if (!weekdays.length || weekdays.includes(isoDow(d))) out.push(d);
    return out;
  }, [from, to, weekdays]);

  const hours = useMemo(() => {
    const [sh, sm] = start.split(':').map(Number), [eh, em] = end.split(':').map(Number);
    let m = (eh * 60 + em) - (sh * 60 + sm);
    if (m <= 0) m += 24 * 60;
    return Math.max(0, m / 60 - (Number(brk) || 0) / 60);
  }, [start, end, brk]);

  const quoteKey = JSON.stringify([siteId, positionId, tariff?.unit, from, to, start, end, headcount, brk, weekdays]);
  const currentQuote = quote?.key === quoteKey ? quote : null;
  useEffect(() => {
    if (!siteId || !positionId || !tariff) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data, error } = await rpc('quote_client_order', {
        _site_id: siteId, _position_id: positionId, _unit: tariff.unit, _from: from, _to: to,
        _start: start, _end: end, _headcount: Number(headcount), _break: Number(brk),
        _weekdays: weekdays.length ? weekdays : null,
      });
      if (!cancelled) setQuote({ key: quoteKey, amount: error ? null : Number(data), error: error?.message ?? '' });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [siteId, positionId, tariff, from, to, start, end, headcount, brk, weekdays, quoteKey]);

  const prefill = (o: Order) => {
    setSiteId(o.site_id); setPositionId(o.position_id); setStart(hhmm(o.start_time)); setEnd(hhmm(o.end_time));
    setBrk(String(o.break_minutes)); setHeadcount(String(o.headcount)); setComment(o.comment ?? ''); setWeekdays(o.weekdays ?? []);
  };

  const toggleDay = (id: number) => setWeekdays((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id]));

  const send = async () => {
    if (!site || !tariff || currentQuote?.amount == null || currentQuote.error) return;
    setBusy(true);
    const { error } = await db('orders').insert({
      org_id: site.org_id, client_id: site.client_id, site_id: site.id, position_id: tariff.position_id, unit: tariff.unit, source: 'cabinet',
      date_from: from, date_to: to, weekdays: weekdays.length ? weekdays : null, start_time: start, end_time: end,
      break_minutes: Number(brk) || 0, headcount: Number(headcount) || 1, reserve_count: 0, comment: comment || null,
    });
    setBusy(false);
    if (error) { toast({ title: 'Заказ не отправлен', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Заказ отправлен', description: 'Менеджер примет его и подберёт людей.' });
    navigate('/client/shifts');
  };

  return (
    <DashboardLayout role="hr">
      <PageMeta title="Новый заказ" description="Оформление заказа персонала" />
      <div className="max-w-2xl mx-auto space-y-4 animate-slide-up">
        <h1 className="text-2xl font-bold">Новый заказ</h1>
        {recent.length > 0 && (
          <div>
            <Label>Повторить прошлый заказ</Label>
            <Select onValueChange={(id) => { const o = recent.find((x) => x.id === id); if (o) prefill(o); }}>
              <SelectTrigger aria-label="Прошлый заказ"><SelectValue placeholder="Выберите заказ" /></SelectTrigger>
              <SelectContent>
                {recent.map((o) => <SelectItem key={o.id} value={o.id}>{sites.find((s) => s.id === o.site_id)?.name ?? 'Объект'}, {o.date_from}, {o.headcount} чел.</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <Card>
          <CardHeader><CardTitle className="text-base">Что и где</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Select value={siteId} onValueChange={(v) => { setSiteId(v); setPositionId(''); }}>
              <SelectTrigger aria-label="Объект"><SelectValue placeholder="Объект" /></SelectTrigger>
              <SelectContent>{siteOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={positionId} onValueChange={setPositionId} disabled={!site}>
              <SelectTrigger aria-label="Позиция"><SelectValue placeholder="Позиция" /></SelectTrigger>
              <SelectContent>
                {positionOptions.map((t) => <SelectItem key={t.position_id} value={t.position_id}>{t.position_name} — {fmtMoney(t.client_rate)}/{t.unit === 'hour' ? 'ч' : t.unit === 'shift' ? 'смена' : 'шт'}</SelectItem>)}
              </SelectContent>
            </Select>
            {!siteOptions.length && <p className="text-sm text-muted-foreground">Пока нет утверждённых тарифов. Обратитесь к вашему менеджеру.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Когда</CardTitle><CardDescription>Для одного дня укажите одну дату. Дни недели оставьте пустыми, если нужны все дни периода.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="co-from">С</Label><Input id="co-from" type="date" min={today()} value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></div>
              <div><Label htmlFor="co-to">По</Label><Input id="co-to" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d) => (
                <Button key={d.id} type="button" size="sm" className="min-h-11 min-w-11" variant={weekdays.includes(d.id) ? 'default' : 'outline'} onClick={() => toggleDay(d.id)}>{d.short}</Button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label htmlFor="co-st">Начало</Label><Input id="co-st" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></div>
              <div><Label htmlFor="co-en">Конец</Label><Input id="co-en" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
              <div><Label htmlFor="co-br">Перерыв, мин</Label><Input id="co-br" inputMode="numeric" value={brk} onChange={(e) => setBrk(e.target.value)} /></div>
            </div>
            <div><Label htmlFor="co-n">Сколько человек</Label><Input id="co-n" type="number" min={1} value={headcount} onChange={(e) => setHeadcount(e.target.value)} /></div>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий для менеджера (необязательно)" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6 space-y-2">
            <div className="flex items-center justify-between">
              <span>Дней: {days.length} · часов в смене: {hours.toFixed(2)}</span>
              {tariff && <Badge variant="secondary">{fmtMoney(tariff.client_rate)}/ч</Badge>}
            </div>
            {currentQuote?.error && <p role="alert" className="text-destructive">{currentQuote.error}</p>}
            <div className="text-2xl font-bold">{currentQuote?.amount == null ? 'Расчёт…' : fmtMoney(currentQuote.amount)}</div>
            <p className="text-xs text-muted-foreground">Ориентировочная сумма с учётом тарифов, ночных и праздничных коэффициентов. Итог — по подтверждённому табелю.</p>
            <Button className="w-full min-h-12" onClick={send} disabled={busy || !tariff || currentQuote?.amount == null || !!currentQuote.error || days.length === 0 || hours <= 0}>Отправить заказ</Button>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default ClientOrder;
