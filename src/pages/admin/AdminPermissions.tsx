import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useOrg } from '@/contexts/OrgContext';
import { db } from '@/lib/db';
import { ROLE_LABELS, STAFF_ROLES } from '@/lib/roles';
import PageMeta from '@/components/PageMeta';

interface Permission { role: string; module: string; action: string; scope: string }

const MODULES: Record<string, string> = {
  clients: 'Заказчики, договоры',
  tariffs: 'Тарифы',
  sites: 'Объекты',
  orders: 'Заказы и смены',
  assignments: 'Назначения',
  timesheets: 'Табель',
  candidates: 'Кандидаты',
  workers: 'Исполнители: анкета, рейтинг',
  worker_documents: 'Документы исполнителей',
  worker_payout_details: 'Реквизиты и налоговый статус',
  accruals: 'Начисления и маржа',
  client_documents: 'Акты, счета, оплаты заказчиков',
  payout_registries: 'Реестры выплат',
  cashflow: 'ДДС и БДР',
  analytics: 'Аналитика',
  deals: 'Сделки и воронка продаж',
  users_directories: 'Пользователи и справочники',
};
const ACTIONS: Record<string, string> = {
  view: 'Смотреть', create: 'Создавать', update: 'Изменять', delete: 'Удалять', export: 'Выгружать',
};
const SCOPES: Record<string, string> = { none: 'Нет', own: 'Свои', department: 'Отдела', all: 'Все' };

const AdminPermissions: React.FC = () => {
  const { toast } = useToast();
  const { orgId } = useOrg();
  const [role, setRole] = useState<string>('director');
  const [perms, setPerms] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data, error } = await db('role_permissions').select('role,module,action,scope').eq('org_id', orgId);
    setLoading(false);
    if (error) {
      toast({ title: 'Не удалось загрузить права', description: error.message, variant: 'destructive' });
      return;
    }
    setPerms(data ?? []);
  }, [orgId, toast]);

  useEffect(() => { load(); }, [load]);

  const scopeOf = useMemo(() => {
    const m = new Map<string, string>();
    perms.filter((p) => p.role === role).forEach((p) => m.set(`${p.module}/${p.action}`, p.scope));
    return (module: string, action: string) => m.get(`${module}/${action}`) ?? 'none';
  }, [perms, role]);

  const change = async (module: string, action: string, scope: string) => {
    if (!orgId) return;
    const previous = perms;
    setPerms((list) => list.map((p) => (p.role === role && p.module === module && p.action === action ? { ...p, scope } : p)));
    const { error } = await db('role_permissions').update({ scope })
      .eq('org_id', orgId).eq('role', role).eq('module', module).eq('action', action);
    if (error) {
      setPerms(previous);
      toast({ title: 'Не удалось изменить право', description: error.message, variant: 'destructive' });
    }
  };

  return (
    <DashboardLayout role="admin">
      <PageMeta title="Права ролей" description="Что может каждая роль в системе" />
      <div className="max-w-5xl mx-auto space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Права ролей</h1>
          <p className="text-muted-foreground">
            Значения по умолчанию взяты из ТЗ. Изменение сохраняется сразу и записывается в журнал.
            Права применяются в разделах по мере их появления на следующих шагах.
          </p>
        </div>

        <Tabs value={role} onValueChange={setRole}>
          <TabsList className="flex-wrap h-auto">
            {STAFF_ROLES.map((r) => <TabsTrigger key={r} value={r}>{ROLE_LABELS[r]}</TabsTrigger>)}
          </TabsList>
        </Tabs>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{ROLE_LABELS[role as keyof typeof ROLE_LABELS]}</CardTitle>
            <CardDescription>
              «Свои» — записи, где сотрудник назначен ответственным; «Отдела» — все записи его отдела; «Все» — вся организация.
              У сотрудника с несколькими ролями действует наибольшая область.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {loading ? <p className="text-muted-foreground">Загрузка…</p> : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Раздел</TableHead>
                    {Object.entries(ACTIONS).map(([k, v]) => <TableHead key={k}>{v}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(MODULES).map(([module, label]) => (
                    <TableRow key={module}>
                      <TableCell className="font-medium">{label}</TableCell>
                      {Object.keys(ACTIONS).map((action) => (
                        <TableCell key={action}>
                          <Select value={scopeOf(module, action)} onValueChange={(v) => change(module, action, v)}>
                            <SelectTrigger className="w-28" aria-label={`${label}: ${ACTIONS[action]}`}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(SCOPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default AdminPermissions;
