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
import { SITE_STATUSES } from '@/lib/sitesMeta';
import type { StaffOption } from '@/lib/clientsMeta';
import PageMeta from '@/components/PageMeta';
import { Plus, Search } from 'lucide-react';

interface Row { id: string; name: string; address: string | null; status: string; client_id: string | null; site_manager_id: string | null }
interface Option { id: string; name: string }

const ALL = 'all';

const SitesList: React.FC = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const { orgId } = useOrg();
  const { can, loading: permsLoading } = usePermissions();
  const [rows, setRows] = useState<Row[]>([]);
  const [clients, setClients] = useState<Option[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(ALL);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', client_id: '', site_manager_id: '' });

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    let q = db('sites').select('id,name,address,status,client_id,site_manager_id').eq('org_id', orgId).order('name').limit(500);
    if (status !== ALL) q = q.eq('status', status);
    const term = search.trim().replace(/[%,()]/g, ' ');
    if (term) q = q.or(`name.ilike.%${term}%,address.ilike.%${term}%`);
    const [s, c, st] = await Promise.all([
      q,
      db('clients').select('id,name').eq('org_id', orgId).order('name'),
      db('staff_profiles').select('user_id,full_name,department').eq('is_active', true),
    ]);
    setLoading(false);
    if (s.error) { toast({ title: 'Не удалось загрузить объекты', description: s.error.message, variant: 'destructive' }); return; }
    setRows(s.data ?? []);
    setClients(c.data ?? []);
    setStaff(st.data ?? []);
  }, [orgId, search, status, toast]);

  useEffect(() => { load(); }, [load]);

  const clientName = (id: string | null) => clients.find((c) => c.id === id)?.name ?? '—';
  const managerName = (id: string | null) => staff.find((s) => s.user_id === id)?.full_name ?? '—';
  const siteStaff = staff.filter((s) => s.department === 'sites');
  const canCreate = can('sites', 'create') || role === 'admin';

  const create = async () => {
    if (!orgId || !form.name.trim()) return;
    setSaving(true);
    const { data, error } = await db('sites').insert({
      org_id: orgId, name: form.name.trim(), client_id: form.client_id || null,
      site_manager_id: form.site_manager_id || user?.id || null, created_by: user?.id,
    }).select('id').single();
    setSaving(false);
    if (error) { toast({ title: 'Не удалось создать объект', description: error.message, variant: 'destructive' }); return; }
    setCreating(false);
    setForm({ name: '', client_id: '', site_manager_id: '' });
    navigate(`/sites/${data.id}`);
  };

  return (
    <AppLayout>
      <PageMeta title="Объекты" description="Объекты заказчиков и их запуск" />
      <div className="max-w-6xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Объекты</h1>
            <p className="text-muted-foreground">Площадки заказчиков. Пока чек-лист запуска не закрыт, смены на объекте исполнителям не публикуются.</p>
          </div>
          {canCreate && <Button onClick={() => setCreating(true)} className="gap-2"><Plus className="w-4 h-4" /> Новый объект</Button>}
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-56">
                <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                <Input className="pl-9" placeholder="Название или адрес" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск" />
              </div>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-48" aria-label="Статус"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Все статусы</SelectItem>
                  {Object.entries(SITE_STATUSES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {permsLoading || loading ? <p className="text-muted-foreground">Загрузка…</p> : (
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Объект</TableHead><TableHead>Заказчик</TableHead><TableHead>Статус</TableHead><TableHead>Менеджер объекта</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link to={`/sites/${s.id}`} className="font-medium hover:underline">{s.name}</Link>
                        {s.address && <div className="text-xs text-muted-foreground">{s.address}</div>}
                      </TableCell>
                      <TableCell>{clientName(s.client_id)}</TableCell>
                      <TableCell><Badge variant={s.status === 'active' ? 'default' : 'secondary'}>{SITE_STATUSES[s.status]}</Badge></TableCell>
                      <TableCell>{managerName(s.site_manager_id)}</TableCell>
                    </TableRow>
                  ))}
                  {!rows.length && <TableRow><TableCell colSpan={4} className="text-muted-foreground">Объектов не найдено.</TableCell></TableRow>}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый объект</DialogTitle>
            <DialogDescription>Адрес, способ отметки, QR и остальное — в карточке объекта и в чек-листе запуска.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor="site-name">Название</Label><Input id="site-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Заказчик</Label>
              <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })}>
                <SelectTrigger><SelectValue placeholder="Выберите заказчика" /></SelectTrigger>
                <SelectContent>{clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {siteStaff.length > 0 && (
              <div className="space-y-2">
                <Label>Менеджер объекта</Label>
                <Select value={form.site_manager_id || user?.id || ''} onValueChange={(v) => setForm({ ...form, site_manager_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Выберите" /></SelectTrigger>
                  <SelectContent>{siteStaff.map((s) => <SelectItem key={s.user_id} value={s.user_id}>{s.full_name}</SelectItem>)}</SelectContent>
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

export default SitesList;
