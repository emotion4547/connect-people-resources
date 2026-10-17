import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { usePermissions } from '@/hooks/usePermissions';
import { db, rpc } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { ORDER_STATUSES, isUrgent, hhmm, type Order } from '@/lib/ordersMeta';
import { OrderForm, emptyOrderForm, orderPayload, type OrderFormValue } from '@/components/orders/OrderForm';
import PageMeta from '@/components/PageMeta';
import { Plus } from 'lucide-react';

interface Option { id: string; name: string }
const ALL = 'all';

const OrdersList: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { orgId } = useOrg();
  const { can, loading: permsLoading } = usePermissions();
  const [rows, setRows] = useState<Order[]>([]);
  const [clients, setClients] = useState<Option[]>([]);
  const [sites, setSites] = useState<Option[]>([]);
  const [positions, setPositions] = useState<Option[]>([]);
  const [status, setStatus] = useState(ALL);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<OrderFormValue>(emptyOrderForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    let q = db('orders').select('*').eq('org_id', orgId).order('starts_at', { ascending: true }).limit(300);
    if (status !== ALL) q = q.eq('status', status);
    const [o, c, s, p] = await Promise.all([
      q,
      db('clients').select('id,name').eq('org_id', orgId),
      db('sites').select('id,name').eq('org_id', orgId),
      db('positions').select('id,name').eq('org_id', orgId),
    ]);
    setLoading(false);
    if (o.error) { toast({ title: 'Не удалось загрузить заказы', description: o.error.message, variant: 'destructive' }); return; }
    // Срочные новые заказы поднимаются наверх (О-3).
    const list: Order[] = [...(o.data ?? [])].sort((a: Order, b: Order) => Number(isUrgent(b)) - Number(isUrgent(a)));
    setRows(list); setClients(c.data ?? []); setSites(s.data ?? []); setPositions(p.data ?? []);
  }, [orgId, status, toast]);

  useEffect(() => { load(); }, [load]);

  const name = (list: Option[], id: string) => list.find((x) => x.id === id)?.name ?? '—';

  const create = async () => {
    if (!orgId) return;
    setSaving(true);
    const { data, error } = await db('orders').insert({
      org_id: orgId, client_id: form.client_id, site_id: form.site_id, position_id: form.position_id, unit: form.unit,
      source: 'manager', ...orderPayload(form),
    }).select('id').single();
    if (error) {
      setSaving(false);
      toast({ title: 'Не удалось создать заказ', description: error.code === '23514' ? 'Проверьте числа и время: начало и конец должны различаться' : error.message, variant: 'destructive' });
      return;
    }
    // Заказ, который менеджер создал сам, принимается сразу (О-4). Если принять не удалось (например, на
    // какую-то дату нет тарифа), заказ остаётся новым, и менеджер видит причину.
    const accepted = await rpc('accept_order', { _order_id: data.id });
    setSaving(false);
    setCreating(false);
    setForm(emptyOrderForm());
    if (accepted.error) {
      toast({ title: 'Заказ создан, но не принят', description: accepted.error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Заказ принят', description: `Создано смен: ${accepted.data}` });
    }
    navigate(`/orders/${data.id}`);
  };

  const formReady = form.client_id && form.site_id && form.position_id && (form.mode === 'range' ? form.date_from && form.date_to : form.dates.length > 0);

  return (
    <AppLayout>
      <PageMeta title="Заказы" description="Заказы заказчиков и смены" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Заказы</h1>
            <p className="text-muted-foreground">Принятый заказ раскладывается на смены по дням. Срочные новые заказы — наверху.</p>
          </div>
          {can('orders', 'create') && <Button onClick={() => setCreating(true)} className="gap-2"><Plus className="w-4 h-4" /> Новый заказ</Button>}
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-52" aria-label="Статус"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все статусы</SelectItem>
                {Object.entries(ORDER_STATUSES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            {permsLoading || loading ? <p className="text-muted-foreground">Загрузка…</p> : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Заказчик и объект</TableHead><TableHead>Позиция</TableHead><TableHead>Период</TableHead><TableHead>Время</TableHead><TableHead>Людей</TableHead><TableHead>Статус</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link to={`/orders/${o.id}`} className="font-medium hover:underline">{name(clients, o.client_id)}</Link>
                        <div className="text-xs text-muted-foreground">{name(sites, o.site_id)}</div>
                      </TableCell>
                      <TableCell>{name(positions, o.position_id)}</TableCell>
                      <TableCell>{fmtDate(o.date_from)}{o.date_to !== o.date_from && ` — ${fmtDate(o.date_to)}`}</TableCell>
                      <TableCell>{hhmm(o.start_time)}–{hhmm(o.end_time)}</TableCell>
                      <TableCell>{o.headcount}{o.reserve_count > 0 && ` + ${o.reserve_count}`}</TableCell>
                      <TableCell className="space-x-2">
                        <Badge variant={o.status === 'new' ? 'default' : 'secondary'}>{ORDER_STATUSES[o.status]}</Badge>
                        {isUrgent(o) && <Badge variant="destructive">срочный</Badge>}
                        {o.source === 'cabinet' && <Badge variant="outline">из кабинета</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!rows.length && <TableRow><TableCell colSpan={6} className="text-muted-foreground">Заказов нет.</TableCell></TableRow>}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Новый заказ</DialogTitle>
            <DialogDescription>Нужен утверждённый тариф заказчика на позицию и дату. Созданный менеджером заказ принимается сразу.</DialogDescription>
          </DialogHeader>
          {orgId && <OrderForm orgId={orgId} value={form} onChange={setForm} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Отмена</Button>
            <Button onClick={create} disabled={saving || !formReady}>Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default OrdersList;
