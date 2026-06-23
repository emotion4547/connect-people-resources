import React, { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Building2, PlusCircle, Edit, Trash2, Users, UserCog, X } from 'lucide-react';
import PageMeta from '@/components/PageMeta';

interface Site {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  is_active: boolean;
}

interface UserOption {
  user_id: string;
  full_name: string | null;
  login: string | null;
  email: string;
}

const AdminSites: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sites, setSites] = useState<Site[]>([]);
  const [hrUsers, setHrUsers] = useState<UserOption[]>([]);
  const [workers, setWorkers] = useState<UserOption[]>([]);
  const [managers, setManagers] = useState<Record<string, string[]>>({});
  const [siteWorkers, setSiteWorkers] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Site | null>(null);
  const [form, setForm] = useState({ name: '', address: '', city: '' });

  const [manageSite, setManageSite] = useState<Site | null>(null);
  const [hrToAdd, setHrToAdd] = useState<string>('');
  const [workerToAdd, setWorkerToAdd] = useState<string>('');

  const [deleteSite, setDeleteSite] = useState<Site | null>(null);

  useEffect(() => {
    void loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [{ data: s }, { data: roles }, { data: profs }, { data: sm }, { data: sw }] = await Promise.all([
        supabase.from('sites').select('*').order('name'),
        supabase.from('user_roles').select('user_id, role'),
        supabase.from('profiles').select('user_id, full_name, login, email'),
        supabase.from('site_managers').select('site_id, hr_user_id'),
        supabase.from('site_workers').select('site_id, worker_user_id'),
      ]);

      setSites(s || []);

      const profMap = new Map((profs || []).map((p) => [p.user_id, p]));
      const hr: UserOption[] = [];
      const wk: UserOption[] = [];
      for (const r of roles || []) {
        const p = profMap.get(r.user_id);
        if (!p) continue;
        const opt: UserOption = { user_id: r.user_id, full_name: p.full_name, login: p.login, email: p.email };
        if (r.role === 'hr') hr.push(opt);
        if (r.role === 'worker') wk.push(opt);
      }
      hr.sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
      wk.sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
      setHrUsers(hr);
      setWorkers(wk);

      const mg: Record<string, string[]> = {};
      for (const row of sm || []) {
        (mg[row.site_id] ||= []).push(row.hr_user_id);
      }
      setManagers(mg);

      const ww: Record<string, string[]> = {};
      for (const row of sw || []) {
        (ww[row.site_id] ||= []).push(row.worker_user_id);
      }
      setSiteWorkers(ww);
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', address: '', city: '' });
    setDialogOpen(true);
  };

  const openEdit = (site: Site) => {
    setEditing(site);
    setForm({ name: site.name, address: site.address || '', city: site.city || '' });
    setDialogOpen(true);
  };

  const saveSite = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Введите название объекта', variant: 'destructive' });
      return;
    }
    try {
      if (editing) {
        const { error } = await supabase
          .from('sites')
          .update({ name: form.name, address: form.address || null, city: form.city || null })
          .eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('sites').insert({
          name: form.name,
          address: form.address || null,
          city: form.city || null,
          created_by: user?.id,
        });
        if (error) throw error;
      }
      toast({ title: editing ? 'Объект обновлён' : 'Объект создан' });
      setDialogOpen(false);
      await loadAll();
    } catch (e: any) {
      toast({ title: 'Ошибка', description: e.message, variant: 'destructive' });
    }
  };

  const confirmDelete = async () => {
    if (!deleteSite) return;
    const { error } = await supabase.from('sites').delete().eq('id', deleteSite.id);
    if (error) {
      toast({ title: 'Ошибка', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Объект удалён' });
      setDeleteSite(null);
      await loadAll();
    }
  };

  const addManager = async () => {
    if (!manageSite || !hrToAdd) return;
    const { error } = await supabase
      .from('site_managers')
      .insert({ site_id: manageSite.id, hr_user_id: hrToAdd });
    if (error) {
      toast({ title: 'Ошибка', description: error.message, variant: 'destructive' });
    } else {
      setHrToAdd('');
      await loadAll();
    }
  };

  const removeManager = async (hrId: string) => {
    if (!manageSite) return;
    await supabase
      .from('site_managers')
      .delete()
      .eq('site_id', manageSite.id)
      .eq('hr_user_id', hrId);
    await loadAll();
  };

  const addWorker = async () => {
    if (!manageSite || !workerToAdd) return;
    const { error } = await supabase
      .from('site_workers')
      .insert({ site_id: manageSite.id, worker_user_id: workerToAdd });
    if (error) {
      toast({ title: 'Ошибка', description: error.message, variant: 'destructive' });
    } else {
      setWorkerToAdd('');
      await loadAll();
    }
  };

  const removeWorker = async (workerId: string) => {
    if (!manageSite) return;
    await supabase
      .from('site_workers')
      .delete()
      .eq('site_id', manageSite.id)
      .eq('worker_user_id', workerId);
    await loadAll();
  };

  const findUser = (list: UserOption[], id: string) =>
    list.find((u) => u.user_id === id);

  const siteManagerIds = manageSite ? managers[manageSite.id] || [] : [];
  const siteWorkerIds = manageSite ? siteWorkers[manageSite.id] || [] : [];
  const availableHr = hrUsers.filter((u) => !siteManagerIds.includes(u.user_id));
  const availableWorkers = workers.filter((u) => !siteWorkerIds.includes(u.user_id));

  return (
    <DashboardLayout role="admin">
      <PageMeta title="Объекты" description="Управление объектами и закреплением менеджеров и исполнителей" />
      <div className="space-y-6 animate-slide-up">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
            <Building2 className="w-7 h-7 text-secondary" />
            Объекты
          </h1>
          <Button onClick={openCreate} className="gap-2">
            <PlusCircle className="w-4 h-4" />
            Добавить объект
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-muted animate-shimmer rounded-lg" />
                ))}
              </div>
            ) : sites.length === 0 ? (
              <div className="text-center py-12">
                <Building2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground">Объектов пока нет</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-3 px-4 text-sm font-medium">Название</th>
                      <th className="text-left py-3 px-4 text-sm font-medium">Город</th>
                      <th className="text-left py-3 px-4 text-sm font-medium">Адрес</th>
                      <th className="text-left py-3 px-4 text-sm font-medium">Менеджеры</th>
                      <th className="text-left py-3 px-4 text-sm font-medium">Исполнители</th>
                      <th className="text-left py-3 px-4 text-sm font-medium">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sites.map((site) => (
                      <tr key={site.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-3 px-4 font-medium">{site.name}</td>
                        <td className="py-3 px-4 text-sm">{site.city || '—'}</td>
                        <td className="py-3 px-4 text-sm text-muted-foreground">{site.address || '—'}</td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="gap-1">
                            <UserCog className="w-3 h-3" />
                            {(managers[site.id] || []).length}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="gap-1">
                            <Users className="w-3 h-3" />
                            {(siteWorkers[site.id] || []).length}
                          </Badge>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setManageSite(site)}>
                              <Users className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(site)}>
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleteSite(site)}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Create/Edit site dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Редактировать объект' : 'Новый объект'}</DialogTitle>
            <DialogDescription>Заполните данные объекта</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Название *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Город</Label>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div>
              <Label>Адрес</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={saveSite}>{editing ? 'Сохранить' : 'Создать'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manage assignments dialog */}
      <Dialog open={!!manageSite} onOpenChange={(o) => !o && setManageSite(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Закрепления — {manageSite?.name}</DialogTitle>
            <DialogDescription>Менеджеры и исполнители объекта</DialogDescription>
          </DialogHeader>

          <Card className="mt-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <UserCog className="w-4 h-4" /> Менеджеры (HR)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Select value={hrToAdd} onValueChange={setHrToAdd}>
                  <SelectTrigger><SelectValue placeholder="Выберите HR" /></SelectTrigger>
                  <SelectContent>
                    {availableHr.length === 0 && (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет доступных HR</div>
                    )}
                    {availableHr.map((u) => (
                      <SelectItem key={u.user_id} value={u.user_id}>
                        {u.full_name || u.login || u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={addManager} disabled={!hrToAdd}>Добавить</Button>
              </div>
              <div className="space-y-1">
                {siteManagerIds.length === 0 && (
                  <p className="text-sm text-muted-foreground">Никто не закреплён</p>
                )}
                {siteManagerIds.map((id) => {
                  const u = findUser(hrUsers, id);
                  return (
                    <div key={id} className="flex items-center justify-between bg-muted/40 px-3 py-2 rounded-md">
                      <span className="text-sm">{u?.full_name || u?.login || u?.email || id}</span>
                      <Button size="sm" variant="ghost" onClick={() => removeManager(id)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4" /> Исполнители
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Select value={workerToAdd} onValueChange={setWorkerToAdd}>
                  <SelectTrigger><SelectValue placeholder="Выберите исполнителя" /></SelectTrigger>
                  <SelectContent>
                    {availableWorkers.length === 0 && (
                      <div className="px-2 py-1.5 text-sm text-muted-foreground">Нет доступных исполнителей</div>
                    )}
                    {availableWorkers.map((u) => (
                      <SelectItem key={u.user_id} value={u.user_id}>
                        {u.full_name || u.login || u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={addWorker} disabled={!workerToAdd}>Добавить</Button>
              </div>
              <div className="space-y-1">
                {siteWorkerIds.length === 0 && (
                  <p className="text-sm text-muted-foreground">Никто не закреплён</p>
                )}
                {siteWorkerIds.map((id) => {
                  const u = findUser(workers, id);
                  return (
                    <div key={id} className="flex items-center justify-between bg-muted/40 px-3 py-2 rounded-md">
                      <span className="text-sm">{u?.full_name || u?.login || u?.email || id}</span>
                      <Button size="sm" variant="ghost" onClick={() => removeWorker(id)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteSite} onOpenChange={(o) => !o && setDeleteSite(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить объект?</AlertDialogTitle>
            <AlertDialogDescription>
              «{deleteSite?.name}» будет удалён вместе со всеми закреплениями. Заявки, привязанные к нему, останутся, но потеряют привязку.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
};

export default AdminSites;
