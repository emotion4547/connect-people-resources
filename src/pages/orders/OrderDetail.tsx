import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { usePermissions } from '@/hooks/usePermissions';
import { db, rpc } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { UNITS } from '@/lib/clientsMeta';
import { ORDER_STATUSES, SHIFT_STATUSES, WEEKDAYS, fmtDateTime, fmtTime, hhmm, isUrgent, type Order, type Shift } from '@/lib/ordersMeta';
import { OrderForm, formFromOrder, orderPayload, type OrderFormValue } from '@/components/orders/OrderForm';
import { OrderMargin } from '@/components/orders/OrderMargin';
import { OrderRotation } from '@/components/orders/OrderRotation';
import PageMeta from '@/components/PageMeta';
import { ArrowLeft } from 'lucide-react';

interface PlanRow { shift_date: string; action: string; affected: number }
const ACTION_LABELS: Record<string, string> = {
  add: 'будет добавлена', update: 'будет обновлена', remove: 'будет убрана', blocked: 'не тронута: на смене есть люди',
};

const OrderDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { can } = usePermissions();
  const [order, setOrder] = useState<Order | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [names, setNames] = useState({ client: '', site: '', position: '', tz: 'Asia/Yekaterinburg' });
  const [reasons, setReasons] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [edit, setEdit] = useState<OrderFormValue | null>(null);
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reasonId, setReasonId] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const o = await db('orders').select('*').eq('id', id).maybeSingle();
    if (o.error || !o.data) { setLoading(false); if (o.error) toast({ title: 'Не удалось загрузить заказ', description: o.error.message, variant: 'destructive' }); return; }
    const ord: Order = o.data;
    setOrder(ord);
    const [s, c, st, p, r] = await Promise.all([
      db('shifts').select('*').eq('order_id', id).order('shift_date'),
      db('clients').select('name').eq('id', ord.client_id).maybeSingle(),
      db('sites').select('name,timezone').eq('id', ord.site_id).maybeSingle(),
      db('positions').select('name').eq('id', ord.position_id).maybeSingle(),
      db('directories').select('id,name').eq('org_id', ord.org_id).eq('kind', 'cancel_reason').eq('is_active', true).order('sort_order'),
    ]);
    setShifts(s.data ?? []);
    setNames({ client: c.data?.name ?? '—', site: st.data?.name ?? '—', position: p.data?.name ?? '—', tz: st.data?.timezone ?? 'Asia/Yekaterinburg' });
    setReasons(r.data ?? []);
    setLoading(false);
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  const accept = async () => {
    setBusy(true);
    const { data, error } = await rpc('accept_order', { _order_id: id });
    setBusy(false);
    if (error) { toast({ title: 'Заказ не принят', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Заказ принят', description: `Создано смен: ${data}` });
    load();
  };

  const repeat = async () => {
    setBusy(true);
    const { data, error } = await rpc('repeat_order_week', { _order_id: id, _copy_assignments: false });
    setBusy(false);
    if (error) { toast({ title: 'Не удалось повторить неделю', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Создан заказ на следующую неделю' });
    navigate(`/orders/${data}`);
  };

  const saveEdit = async () => {
    if (!edit || !order) return;
    setBusy(true);
    const { error } = await db('orders').update(orderPayload(edit)).eq('id', order.id);
    if (error) {
      setBusy(false);
      toast({ title: 'Не удалось сохранить', description: error.code === '23514' ? 'Проверьте числа и время' : error.message, variant: 'destructive' });
      return;
    }
    setEdit(null);
    await load();
    // Принятый заказ: показываем, что изменится в сменах, до того как менять их.
    if (order.status !== 'new') {
      const { data, error: planError } = await rpc('regenerate_order_shifts', { _order_id: order.id, _dry_run: true });
      if (planError) toast({ title: 'Не удалось построить план смен', description: planError.message, variant: 'destructive' });
      else setPlan(data ?? []);
    }
    setBusy(false);
  };

  const applyPlan = async () => {
    setBusy(true);
    const { error } = await rpc('regenerate_order_shifts', { _order_id: id, _dry_run: false });
    setBusy(false);
    if (error) { toast({ title: 'Не удалось применить', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Смены обновлены' });
    setPlan(null);
    load();
  };

  const cancel = async () => {
    setBusy(true);
    const { error } = await rpc('cancel_order', { _order_id: id, _reason_id: reasonId });
    setBusy(false);
    if (error) { toast({ title: 'Не удалось отменить', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Заказ отменён' });
    setCancelling(false);
    load();
  };

  const canEdit = can('orders', 'update');
  const editable = order && ['new', 'accepted'].includes(order.status);

  return (
    <AppLayout>
      <PageMeta title="Заказ" description="Карточка заказа и смены" />
      <div className="max-w-5xl mx-auto space-y-6 animate-slide-up">
        <Link to="/orders" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Все заказы
        </Link>
        {loading ? <p className="text-muted-foreground">Загрузка…</p> : !order ? <p className="text-muted-foreground">Заказ не найден или нет доступа.</p> : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold">{names.client}</h1>
              <Badge>{ORDER_STATUSES[order.status]}</Badge>
              {isUrgent(order) && <Badge variant="destructive">срочный</Badge>}
              {order.kind === 'rotation' && <Badge variant="secondary">вахта</Badge>}
            </div>

            <Card>
              <CardHeader><CardTitle className="text-lg">Параметры</CardTitle></CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
                <div><span className="text-muted-foreground">Объект: </span>{names.site}</div>
                <div><span className="text-muted-foreground">Позиция: </span>{names.position} ({UNITS[order.unit]})</div>
                <div><span className="text-muted-foreground">Период: </span>{fmtDate(order.date_from)} — {fmtDate(order.date_to)}</div>
                <div><span className="text-muted-foreground">Дни: </span>{order.dates?.length ? `${order.dates.length} дат` : order.weekdays?.length ? order.weekdays.map((d) => WEEKDAYS.find((w) => w.id === d)?.short).join(', ') : 'каждый день'}</div>
                <div><span className="text-muted-foreground">Время: </span>{hhmm(order.start_time)}–{hhmm(order.end_time)}, перерыв {order.break_minutes} мин ({names.tz})</div>
                <div><span className="text-muted-foreground">Людей: </span>{order.headcount}{order.reserve_count > 0 && ` + резерв ${order.reserve_count}`}</div>
                {order.requirements && <div className="sm:col-span-2"><span className="text-muted-foreground">Требования: </span>{order.requirements}</div>}
                {order.comment && <div className="sm:col-span-2"><span className="text-muted-foreground">Комментарий: </span>{order.comment}</div>}
                <div className="sm:col-span-2 flex flex-wrap gap-2 pt-2">
                  {canEdit && order.status === 'new' && <Button onClick={accept} disabled={busy}>Принять заказ</Button>}
                  {canEdit && editable && <Button variant="outline" onClick={() => setEdit(formFromOrder(order))}>Изменить</Button>}
                  {can('orders', 'create') && order.status !== 'new' && order.status !== 'cancelled' && <Button variant="outline" onClick={repeat} disabled={busy}>Повторить неделю</Button>}
                  {canEdit && !['completed', 'cancelled'].includes(order.status) && <Button variant="outline" onClick={() => setCancelling(true)}>Отменить заказ</Button>}
                </div>
              </CardContent>
            </Card>

            {order.status !== 'cancelled' && (
              <OrderRotation orderId={order.id} dateFrom={order.date_from} dateTo={order.date_to} closed={['completed', 'cancelled'].includes(order.status)}
                canEdit={canEdit} canAccrue={can('accruals', 'create')} onChanged={load} />
            )}

            {can('accruals', 'view') && order.status !== 'new' && (
              <OrderMargin orderId={order.id} siteId={order.site_id} dateFrom={order.date_from} dateTo={order.date_to} />
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Смены ({shifts.length})</CardTitle>
                <CardDescription>Время — по часовому поясу объекта. Ставки смены копируются из тарифа в момент создания и не меняются при правке тарифа.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Дата</TableHead><TableHead>Время</TableHead><TableHead>Людей</TableHead><TableHead>Статус</TableHead><TableHead>Публикация</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {shifts.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{fmtDate(s.shift_date)}</TableCell>
                        <TableCell>{fmtTime(s.start_at, names.tz)}–{fmtTime(s.end_at, names.tz)}{new Date(s.end_at).getTime() - new Date(s.start_at).getTime() > 0 && fmtDateTime(s.end_at, names.tz).slice(0, 5) !== fmtDateTime(s.start_at, names.tz).slice(0, 5) && ' (+1 день)'}</TableCell>
                        <TableCell>{s.headcount}{s.reserve_count > 0 && ` + ${s.reserve_count}`}</TableCell>
                        <TableCell><Badge variant="secondary">{SHIFT_STATUSES[s.status]}</Badge></TableCell>
                        <TableCell>{s.published_at ? 'опубликована' : s.status === 'cancelled' ? '—' : 'ждёт запуска объекта'}</TableCell>
                      </TableRow>
                    ))}
                    {!shifts.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Смен пока нет: они создаются, когда заказ принят.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Dialog open={!!edit} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Изменить заказ</DialogTitle>
            <DialogDescription>Заказчик, объект и позиция не меняются: для этого создайте новый заказ. У принятого заказа сначала покажем, что изменится в сменах.</DialogDescription>
          </DialogHeader>
          {edit && order && <OrderForm orgId={order.org_id} value={edit} onChange={setEdit} lockedKeys />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Отмена</Button>
            <Button onClick={saveEdit} disabled={busy}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!plan} onOpenChange={(open) => !open && setPlan(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Что изменится в сменах</DialogTitle>
            <DialogDescription>Прошедшие и идущие смены не затрагиваются. Смены с людьми молча не меняются: их вы решаете сами.</DialogDescription>
          </DialogHeader>
          {plan && (plan.length === 0 ? <p className="text-sm text-muted-foreground">Смены менять не нужно.</p> : (
            <ul className="space-y-1 text-sm">
              {plan.map((p) => (
                <li key={`${p.shift_date}-${p.action}`} className={p.action === 'blocked' ? 'text-destructive' : ''}>
                  {fmtDate(p.shift_date)}: {ACTION_LABELS[p.action] ?? p.action}{p.action === 'blocked' && ` (людей: ${p.affected})`}
                </li>
              ))}
            </ul>
          ))}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlan(null)}>Оставить смены как есть</Button>
            <Button onClick={applyPlan} disabled={busy || !plan?.some((p) => p.action !== 'blocked')}>Применить к сменам</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Отменить заказ</DialogTitle>
            <DialogDescription>Будущие смены заказа будут отменены. Причина нужна для аналитики.</DialogDescription>
          </DialogHeader>
          <Select value={reasonId} onValueChange={setReasonId}>
            <SelectTrigger aria-label="Причина"><SelectValue placeholder="Причина отмены" /></SelectTrigger>
            <SelectContent>{reasons.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(false)}>Назад</Button>
            <Button variant="destructive" onClick={cancel} disabled={busy || !reasonId}>Отменить заказ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default OrderDetail;
