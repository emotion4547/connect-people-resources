import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { usePermissions } from '@/hooks/usePermissions';
import { db, rpc } from '@/lib/db';
import { fmtDate, fmtMoney, monthEnd, monthStart } from '@/lib/format';
import { DOC_KINDS, DOC_STATUSES, type ClientDocument } from '@/lib/documentsMeta';
import PageMeta from '@/components/PageMeta';
import { Plus } from 'lucide-react';

const ALL = 'all';

const DocumentsList: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { orgId } = useOrg();
  const { can } = usePermissions();
  const [rows, setRows] = useState<ClientDocument[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState(ALL);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [clientId, setClientId] = useState('');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    let q = db('client_documents').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(300);
    if (status !== ALL) q = q.eq('status', status);
    const [d, c] = await Promise.all([q, db('clients').select('id,name').eq('org_id', orgId).order('name')]);
    setLoading(false);
    if (d.error) { toast({ title: 'Не удалось загрузить документы', description: d.error.message, variant: 'destructive' }); return; }
    setRows(d.data ?? []); setClients(c.data ?? []);
  }, [orgId, status, toast]);

  useEffect(() => { load(); }, [load]);

  const name = (id: string) => clients.find((c) => c.id === id)?.name ?? '—';

  const build = async () => {
    setBusy(true);
    const { data, error } = await rpc('generate_client_documents', { _client_id: clientId, _from: from, _to: to });
    setBusy(false);
    if (error) { toast({ title: 'Документы не собраны', description: error.message, variant: 'destructive' }); return; }
    setBuilding(false);
    navigate(`/documents/${data}`);
  };

  return (
    <AppLayout>
      <PageMeta title="Документы заказчикам" description="Акты, УПД и счета" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Документы заказчикам</h1>
            <p className="text-muted-foreground">Акты и счета собираются из подтверждённых начислений. Выставленный документ не правится — только аннулируется с причиной.</p>
          </div>
          {can('client_documents', 'create') && <Button className="gap-2" onClick={() => setBuilding(true)}><Plus className="w-4 h-4" /> Сформировать</Button>}
        </div>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-52" aria-label="Статус"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все статусы</SelectItem>
                {Object.entries(DOC_STATUSES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            {loading ? <p className="text-muted-foreground">Загрузка…</p> : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Документ</TableHead><TableHead>Заказчик</TableHead><TableHead>Период</TableHead><TableHead className="text-right">Сумма</TableHead><TableHead>Статус</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>
                        <Link to={`/documents/${d.id}`} className="font-medium hover:underline">{DOC_KINDS[d.kind]}{d.number ? ` № ${d.number}` : ''}</Link>
                        {d.issue_date && <div className="text-xs text-muted-foreground">от {fmtDate(d.issue_date)}</div>}
                      </TableCell>
                      <TableCell>{name(d.client_id)}</TableCell>
                      <TableCell>{fmtDate(d.period_from)} — {fmtDate(d.period_to)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(d.amount_total)}</TableCell>
                      <TableCell className="space-x-2">
                        <Badge variant={d.status === 'cancelled' ? 'destructive' : d.status === 'draft' ? 'outline' : 'secondary'}>{DOC_STATUSES[d.status]}</Badge>
                        {d.has_open_timesheets && d.status === 'draft' && <Badge variant="destructive">есть неподтверждённые табели</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!rows.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Документов нет.</TableCell></TableRow>}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={building} onOpenChange={setBuilding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Сформировать акт и счёт</DialogTitle>
            <DialogDescription>В документ войдут все утверждённые начисления заказчика, ещё не попавшие в другой документ. Черновик можно пересобрать.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger aria-label="Заказчик"><SelectValue placeholder="Заказчик" /></SelectTrigger>
              <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="d-from">С</Label><Input id="d-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div><Label htmlFor="d-to">По</Label><Input id="d-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuilding(false)}>Отмена</Button>
            <Button onClick={build} disabled={busy || !clientId}>Сформировать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default DocumentsList;
