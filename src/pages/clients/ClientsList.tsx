import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';
import { usePermissions } from '@/hooks/usePermissions';
import { db } from '@/lib/db';
import { CLIENT_STATUSES, type StaffOption } from '@/lib/clientsMeta';
import PageMeta from '@/components/PageMeta';
import { downloadExcel } from '@/lib/csv';
import { Download, Plus, Search } from 'lucide-react';

interface ClientRow {
  id: string; name: string; inn: string | null; city: string | null; status: string;
  sales_manager_id: string | null; sites_manager_id: string | null;
}

const PAGE_SIZE = 25;
const ALL = 'all';

const ClientsList: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { orgId } = useOrg();
  const { can, loading: permsLoading } = usePermissions();
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(ALL);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', inn: '', city: '', sales_manager_id: '' });

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    let q = db('clients')
      .select('id,name,inn,city,status,sales_manager_id,sites_manager_id', { count: 'exact' })
      .eq('org_id', orgId)
      .order('name')
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (status !== ALL) q = q.eq('status', status);
    const term = search.trim().replace(/[%,()]/g, ' ');
    if (term) q = q.or(`name.ilike.%${term}%,inn.ilike.%${term}%`);
    const { data, count, error } = await q;
    setLoading(false);
    if (error) {
      toast({ title: 'Не удалось загрузить заказчиков', description: error.message, variant: 'destructive' });
      return;
    }
    setRows(data ?? []);
    setTotal(count ?? 0);
  }, [orgId, page, search, status, toast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [search, status, orgId]);

  // Выгрузка в Excel: все заказчики по текущим фильтрам, а не только страница.
  const exportCsv = async () => {
    if (!orgId) return;
    let q = db('clients').select('name,inn,city,status,sales_manager_id,sites_manager_id').eq('org_id', orgId).order('name').limit(10000);
    if (status !== ALL) q = q.eq('status', status);
    const term = search.trim().replace(/[%,()]/g, ' ');
    if (term) q = q.or(`name.ilike.%${term}%,inn.ilike.%${term}%`);
    const { data, error } = await q;
    if (error) { toast({ title: 'Не удалось выгрузить', description: error.message, variant: 'destructive' }); return; }
    const who = (id: string | null) => staff.find((x) => x.user_id === id)?.full_name ?? '';
    downloadExcel('zakazchiki.xlsx', ['Название', 'ИНН', 'Город', 'Статус', 'Менеджер продаж', 'Менеджер объектов'],
      (data ?? []).map((c: ClientRow) => [c.name, c.inn, c.city, CLIENT_STATUSES[c.status], who(c.sales_manager_id), who(c.sites_manager_id)]));
  };

  useEffect(() => {
    if (!orgId) return;
    db('staff_profiles').select('user_id,full_name,department').eq('is_active', true).then(({ data }: { data: StaffOption[] | null }) => setStaff(data ?? []));
  }, [orgId]);

  const nameOf = (id: string | null) => staff.find((s) => s.user_id === id)?.full_name ?? '—';
  const salesStaff = staff.filter((s) => s.department === 'sales');

  const create = async () => {
    if (!orgId || !form.name.trim()) return;
    setSaving(true);
    const { data, error } = await db('clients').insert({
      org_id: orgId, name: form.name.trim(), inn: form.inn.trim() || null, city: form.city.trim() || null,
      sales_manager_id: form.sales_manager_id || user?.id || null,
    }).select('id').single();
    setSaving(false);
    if (error) {
      const text = error.code === '23505' ? 'Заказчик с таким ИНН уже есть' : error.code === '23514' ? 'ИНН — 10 или 12 цифр' : error.message;
      toast({ title: 'Не удалось создать заказчика', description: text, variant: 'destructive' });
      return;
    }
    setCreating(false);
    setForm({ name: '', inn: '', city: '', sales_manager_id: '' });
    navigate(`/clients/${data.id}`);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AppLayout>
      <PageMeta title="Заказчики" description="Заказчики, договоры и тарифы" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Заказчики</h1>
            <p className="text-muted-foreground">Компании-клиенты, их договоры и тарифы. Заказ можно создать только по утверждённому тарифу.</p>
          </div>
          {can('clients', 'create') && (
            <Button onClick={() => setCreating(true)} className="gap-2"><Plus className="w-4 h-4" /> Новый заказчик</Button>
          )}
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-56">
                <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input className="pl-9" placeholder="Название или ИНН" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск" />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-48" aria-label="Статус"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Все статусы</SelectItem>
                  {Object.entries(CLIENT_STATUSES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" className="gap-2" onClick={exportCsv}><Download className="w-4 h-4" /> В Excel</Button>
            </div>

            {permsLoading || loading ? <p className="text-muted-foreground">Загрузка…</p> : !can('clients', 'view') ? (
              <p className="text-muted-foreground">У вашей роли нет доступа к заказчикам.</p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Название</TableHead>
                      <TableHead>ИНН</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Менеджер по продажам</TableHead>
                      <TableHead>Менеджер объектов</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link to={`/clients/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                          {c.city && <div className="text-xs text-muted-foreground">{c.city}</div>}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{c.inn ?? '—'}</TableCell>
                        <TableCell><Badge variant={c.status === 'active' ? 'default' : 'secondary'}>{CLIENT_STATUSES[c.status]}</Badge></TableCell>
                        <TableCell>{nameOf(c.sales_manager_id)}</TableCell>
                        <TableCell>{nameOf(c.sites_manager_id)}</TableCell>
                      </TableRow>
                    ))}
                    {!rows.length && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Заказчиков не найдено.</TableCell></TableRow>}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Всего: {total}</span>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</Button>
                    <span>{page + 1} / {pages}</span>
                    <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Вперёд</Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый заказчик</DialogTitle>
            <DialogDescription>Остальные реквизиты, контакты, договор и тарифы — в карточке заказчика.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="client-name">Название</Label>
              <Input id="client-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="client-inn">ИНН</Label>
                <Input id="client-inn" inputMode="numeric" value={form.inn} onChange={(e) => setForm({ ...form, inn: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-city">Город</Label>
                <Input id="client-city" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
            </div>
            {salesStaff.length > 0 && (
              <div className="space-y-2">
                <Label>Менеджер по продажам</Label>
                <Select value={form.sales_manager_id || user?.id || ''} onValueChange={(v) => setForm({ ...form, sales_manager_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Выберите" /></SelectTrigger>
                  <SelectContent>
                    {salesStaff.map((s) => <SelectItem key={s.user_id} value={s.user_id}>{s.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Отмена</Button>
            <Button onClick={create} disabled={saving || !form.name.trim()}>Создать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default ClientsList;
