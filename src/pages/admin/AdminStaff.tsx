import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useAuth, type AppRole } from '@/contexts/AuthContext';
import { useOrg } from '@/contexts/OrgContext';
import { db, rpc, invokeFunction } from '@/lib/db';
import { DEPARTMENTS, ROLE_LABELS, STAFF_ROLES } from '@/lib/roles';
import PageMeta from '@/components/PageMeta';
import { UserPlus } from 'lucide-react';

interface StaffRow {
  user_id: string; full_name: string; department: string; job_title: string | null; phone: string | null;
  is_department_head: boolean; is_active: boolean; email: string | null; roles: AppRole[];
}
interface EditForm {
  user_id: string | null; email: string; full_name: string; department: string; job_title: string;
  phone: string; is_department_head: boolean; roles: AppRole[];
}

const emptyForm: EditForm = {
  user_id: null, email: '', full_name: '', department: 'sales', job_title: '', phone: '',
  is_department_head: false, roles: [],
};

const AdminStaff: React.FC = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { orgId } = useOrg();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [blockTarget, setBlockTarget] = useState<StaffRow | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data: roleRows, error: rolesError } = await db('user_roles').select('user_id, role').eq('org_id', orgId);
    if (rolesError) {
      toast({ title: 'Не удалось загрузить сотрудников', description: rolesError.message, variant: 'destructive' });
      setLoading(false);
      return;
    }
    const staffRoleRows = (roleRows ?? []).filter((r: { role: AppRole }) => STAFF_ROLES.includes(r.role));
    const ids: string[] = Array.from(new Set<string>(staffRoleRows.map((r: { user_id: string }) => r.user_id)));
    if (!ids.length) {
      setRows([]);
      setLoading(false);
      return;
    }
    const [{ data: profiles }, { data: emails }] = await Promise.all([
      db('staff_profiles').select('*').in('user_id', ids),
      db('profiles').select('user_id, email').in('user_id', ids),
    ]);
    const emailById = new Map<string, string>((emails ?? []).map((e: { user_id: string; email: string }) => [e.user_id, e.email]));
    const list: StaffRow[] = ids.map((id) => {
      const p = (profiles ?? []).find((x: { user_id: string }) => x.user_id === id);
      return {
        user_id: id,
        full_name: p?.full_name ?? emailById.get(id) ?? id,
        department: p?.department ?? 'admin',
        job_title: p?.job_title ?? null,
        phone: p?.phone ?? null,
        is_department_head: p?.is_department_head ?? false,
        is_active: p?.is_active ?? true,
        email: emailById.get(id) ?? null,
        roles: staffRoleRows.filter((r: { user_id: string }) => r.user_id === id).map((r: { role: AppRole }) => r.role),
      };
    }).sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru'));
    setRows(list);
    setLoading(false);
  }, [orgId, toast]);

  useEffect(() => { load(); }, [load]);

  const toggleRole = (role: AppRole, on: boolean) =>
    setForm((f) => (f ? { ...f, roles: on ? [...f.roles, role] : f.roles.filter((r) => r !== role) } : f));

  const openEdit = (s: StaffRow) => setForm({
    user_id: s.user_id, email: s.email ?? '', full_name: s.full_name, department: s.department,
    job_title: s.job_title ?? '', phone: s.phone ?? '', is_department_head: s.is_department_head, roles: s.roles,
  });

  const save = async () => {
    if (!form || !orgId) return;
    if (!form.full_name.trim() || form.roles.length === 0) {
      toast({ title: 'Укажите ФИО и хотя бы одну роль', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      if (form.user_id === null) {
        const { data, error } = await invokeFunction('invite-staff', {
          org_id: orgId, email: form.email, full_name: form.full_name, department: form.department,
          roles: form.roles, job_title: form.job_title || null, phone: form.phone || null,
        });
        if (error || data?.error) throw new Error(data?.error ?? error.message);
        setInviteLink(data.action_link ?? null);
        toast({
          title: data.created ? 'Сотрудник заведён' : 'Роли добавлены',
          description: data.created ? 'Передайте ему ссылку для установки пароля.' : 'Сотрудник уже есть в системе.',
        });
      } else {
        const current = rows.find((r) => r.user_id === form.user_id);
        const { error: profileError } = await rpc('update_staff_profile', {
          _user_id: form.user_id, _full_name: form.full_name.trim(), _department: form.department,
          _job_title: form.job_title || null, _phone: form.phone || null, _is_department_head: form.is_department_head,
        });
        if (profileError) throw profileError;

        const before = current?.roles ?? [];
        const toAdd = form.roles.filter((r) => !before.includes(r));
        const toRemove = before.filter((r) => !form.roles.includes(r));
        if (form.user_id === user?.id && toRemove.includes('admin')) {
          throw new Error('Нельзя снять роль администратора с самого себя');
        }
        if (toAdd.length) {
          const { error } = await db('user_roles').insert(toAdd.map((role) => ({ user_id: form.user_id, role, org_id: orgId })));
          if (error) throw error;
        }
        for (const role of toRemove) {
          const { error } = await db('user_roles').delete().eq('user_id', form.user_id).eq('org_id', orgId).eq('role', role);
          if (error) throw error;
        }
        toast({ title: 'Сохранено' });
      }
      setForm(null);
      await load();
    } catch (e) {
      toast({ title: 'Не удалось сохранить', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const block = async () => {
    if (!blockTarget) return;
    setSaving(true);
    const { error } = await rpc('block_staff', { _user_id: blockTarget.user_id, _reason: blockReason });
    setSaving(false);
    if (error) {
      toast({ title: 'Не удалось заблокировать', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Сотрудник заблокирован', description: 'Вход закрыт, доступ отозван сразу.' });
    setBlockTarget(null);
    setBlockReason('');
    load();
  };

  const unblock = async (s: StaffRow) => {
    const { error } = await rpc('unblock_staff', { _user_id: s.user_id });
    if (error) {
      toast({ title: 'Не удалось разблокировать', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Доступ восстановлен' });
    load();
  };

  const active = useMemo(() => rows.filter((r) => r.is_active), [rows]);
  const blocked = useMemo(() => rows.filter((r) => !r.is_active), [rows]);

  const renderTable = (list: StaffRow[]) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Сотрудник</TableHead>
          <TableHead>Отдел</TableHead>
          <TableHead>Роли</TableHead>
          <TableHead className="w-56" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {list.map((s) => (
          <TableRow key={s.user_id}>
            <TableCell>
              <div className="font-medium">{s.full_name}{s.is_department_head && <Badge variant="outline" className="ml-2">руководитель отдела</Badge>}</div>
              <div className="text-xs text-muted-foreground">{s.email}{s.job_title ? ` · ${s.job_title}` : ''}</div>
            </TableCell>
            <TableCell>{DEPARTMENTS[s.department] ?? s.department}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {s.roles.map((r) => <Badge key={r} variant="secondary">{ROLE_LABELS[r]}</Badge>)}
              </div>
            </TableCell>
            <TableCell className="text-right space-x-2">
              <Button variant="outline" size="sm" onClick={() => openEdit(s)}>Изменить</Button>
              {s.is_active
                ? s.user_id !== user?.id && <Button variant="outline" size="sm" onClick={() => setBlockTarget(s)}>Заблокировать</Button>
                : <Button variant="outline" size="sm" onClick={() => unblock(s)}>Разблокировать</Button>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <DashboardLayout role="admin">
      <PageMeta title="Сотрудники" description="Сотрудники организации, их отделы и роли" />
      <div className="max-w-5xl mx-auto space-y-6 animate-slide-up">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Сотрудники</h1>
            <p className="text-muted-foreground">
              Сотрудники выбранной организации. Права ролей настраиваются в разделе «Права».
            </p>
          </div>
          <Button onClick={() => { setInviteLink(null); setForm(emptyForm); }} className="gap-2">
            <UserPlus className="w-4 h-4" /> Добавить сотрудника
          </Button>
        </div>

        {inviteLink && (
          <Card className="border-primary">
            <CardContent className="pt-6 space-y-2">
              <p className="font-medium">Ссылка для установки пароля</p>
              <p className="text-sm text-muted-foreground">
                Почтовый сервер не подключён, письмо не отправлено. Передайте ссылку сотруднику лично или в мессенджере: она одноразовая и даёт вход в его учётную запись.
                После закрытия этого сообщения ссылку повторно увидеть нельзя.
              </p>
              <div className="flex gap-2">
                <Input readOnly value={inviteLink} onFocus={(e) => e.currentTarget.select()} />
                <Button variant="outline" onClick={() => navigator.clipboard.writeText(inviteLink)}>Копировать</Button>
                <Button variant="ghost" onClick={() => setInviteLink(null)}>Закрыть</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-6">
            {loading ? <p className="text-muted-foreground">Загрузка…</p>
              : active.length ? renderTable(active) : <p className="text-muted-foreground">Сотрудников пока нет.</p>}
          </CardContent>
        </Card>

        {blocked.length > 0 && (
          <Card>
            <CardContent className="pt-6 space-y-3">
              <h2 className="font-semibold">Заблокированные</h2>
              {renderTable(blocked)}
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!form} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.user_id ? 'Сотрудник' : 'Новый сотрудник'}</DialogTitle>
            <DialogDescription>
              {form?.user_id ? 'Роли действуют в выбранной организации.' : 'Будет создана учётная запись; пароль сотрудник задаст по ссылке.'}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              {!form.user_id && (
                <div className="space-y-2">
                  <Label htmlFor="staff-email">Email</Label>
                  <Input id="staff-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="staff-name">ФИО</Label>
                <Input id="staff-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Отдел</Label>
                  <Select value={form.department} onValueChange={(v) => setForm({ ...form, department: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(DEPARTMENTS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="staff-title">Должность</Label>
                  <Input id="staff-title" value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-phone">Телефон</Label>
                <Input id="staff-phone" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              {form.user_id && (
                <label className="flex items-center gap-3 text-sm">
                  <Switch checked={form.is_department_head} onCheckedChange={(on) => setForm({ ...form, is_department_head: on })} />
                  Руководитель отдела (видит все записи отдела)
                </label>
              )}
              <div className="space-y-2">
                <Label>Роли</Label>
                <div className="grid gap-2">
                  {STAFF_ROLES.map((r) => (
                    <label key={r} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={form.roles.includes(r)} onCheckedChange={(on) => toggleRole(r, on === true)} />
                      {ROLE_LABELS[r]}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Отмена</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!blockTarget} onOpenChange={(open) => !open && setBlockTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Заблокировать {blockTarget?.full_name}</DialogTitle>
            <DialogDescription>
              Вход закроется, открытые сессии завершатся, доступ к данным пропадёт сразу. Причина запишется в журнал.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="block-reason">Причина</Label>
            <Textarea id="block-reason" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBlockTarget(null)}>Отмена</Button>
            <Button variant="destructive" onClick={block} disabled={saving || !blockReason.trim()}>Заблокировать</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminStaff;
