import React, { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { BarChart3, Download, FileText, Users, CheckCircle, Activity } from 'lucide-react';
import { format, subDays, startOfDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import PageMeta from '@/components/PageMeta';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  CartesianGrid,
} from 'recharts';

interface RequestRow {
  id: string;
  status: string;
  created_at: string;
  hr_id: string;
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Новые',
  in_progress: 'В работе',
  assigned: 'Назначено',
  pending_confirmation: 'Ожидает',
  completed: 'Выполнено',
  cancelled: 'Отменено',
};
const STATUS_COLORS: Record<string, string> = {
  new: 'hsl(var(--status-orange))',
  in_progress: 'hsl(var(--primary))',
  assigned: 'hsl(var(--secondary))',
  pending_confirmation: '#8b5cf6',
  completed: 'hsl(var(--status-success))',
  cancelled: 'hsl(var(--muted-foreground))',
};

const AdminReports: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [workersCount, setWorkersCount] = useState(0);
  const [responsesCount, setResponsesCount] = useState(0);

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = subDays(new Date(), 30).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo, setDateTo] = useState(today);

  useEffect(() => {
    const fetchAll = async () => {
      const [requestsRes, workersRes, responsesRes] = await Promise.all([
        supabase.from('requests').select('id, status, created_at, hr_id').order('created_at', { ascending: false }).limit(2000),
        supabase.from('user_roles').select('id', { count: 'exact', head: true }).eq('role', 'worker'),
        supabase.from('responses').select('id', { count: 'exact', head: true }),
      ]);
      setRequests((requestsRes.data as RequestRow[]) || []);
      setWorkersCount(workersRes.count || 0);
      setResponsesCount(responsesRes.count || 0);
      setLoading(false);
    };
    fetchAll();
  }, []);

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      const day = r.created_at.slice(0, 10);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      return true;
    });
  }, [requests, dateFrom, dateTo]);

  const stats = useMemo(
    () => ({
      totalRequests: filtered.length,
      completedRequests: filtered.filter((r) => r.status === 'completed').length,
      activeRequests: filtered.filter((r) => ['new', 'in_progress', 'assigned'].includes(r.status)).length,
      cancelledRequests: filtered.filter((r) => r.status === 'cancelled').length,
    }),
    [filtered],
  );

  const statusData = useMemo(() => {
    const map = new Map<string, number>();
    filtered.forEach((r) => map.set(r.status, (map.get(r.status) || 0) + 1));
    return Array.from(map.entries()).map(([status, count]) => ({
      name: STATUS_LABELS[status] || status,
      value: count,
      status,
    }));
  }, [filtered]);

  const dailyData = useMemo(() => {
    const map = new Map<string, number>();
    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    for (let d = startOfDay(from); d <= to; d = new Date(d.getTime() + 86400000)) {
      map.set(d.toISOString().slice(0, 10), 0);
    }
    filtered.forEach((r) => {
      const day = r.created_at.slice(0, 10);
      if (map.has(day)) map.set(day, (map.get(day) || 0) + 1);
    });
    return Array.from(map.entries()).map(([date, count]) => ({
      date: format(new Date(date), 'd MMM', { locale: ru }),
      count,
    }));
  }, [filtered, dateFrom, dateTo]);

  const handleExportRequests = async () => {
    const { data } = await supabase.from('requests').select('*').order('created_at', { ascending: false });
    if (!data) return;
    const hrIds = [...new Set(data.map((r) => r.hr_id))];
    const { data: profiles } = await supabase.from('profiles').select('user_id, company').in('user_id', hrIds);
    const profileMap = new Map(profiles?.map((p) => [p.user_id, p.company]) || []);

    const csvContent = [
      ['ID', 'Компания', 'Должность', 'Дата', 'Адрес', 'Кол-во', 'Статус'].join(','),
      ...data.map((r) =>
        [r.id, profileMap.get(r.hr_id) || '', r.position, r.start_date, `"${r.address}"`, r.quantity, r.status].join(','),
      ),
    ].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `requests_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
  };

  const handleExportWorkers = async () => {
    const { data: roles } = await supabase.from('user_roles').select('user_id').eq('role', 'worker');
    if (!roles?.length) return;
    const { data } = await supabase.from('profiles').select('*').in('user_id', roles.map((r) => r.user_id));
    if (!data) return;
    const csvContent = [
      ['ID', 'ФИО', 'Email', 'Телефон', 'Город', 'Рейтинг', 'Статус'].join(','),
      ...data.map((w) =>
        [w.id, w.full_name || '', w.email, w.phone || '', w.city || '', w.rating, w.is_active ? 'Активен' : 'Заблокирован'].join(','),
      ),
    ].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `workers_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
  };

  const cards = [
    { label: 'Заявок за период', value: stats.totalRequests, icon: <FileText className="w-6 h-6" />, color: 'text-primary' },
    { label: 'Выполнено', value: stats.completedRequests, icon: <CheckCircle className="w-6 h-6" />, color: 'text-status-success' },
    { label: 'Активные', value: stats.activeRequests, icon: <Activity className="w-6 h-6" />, color: 'text-status-orange' },
    { label: 'Исполнителей всего', value: workersCount, icon: <Users className="w-6 h-6" />, color: 'text-secondary' },
  ];

  return (
    <DashboardLayout role="admin">
      <PageMeta title="Отчеты" description="Статистика и отчеты системы" />
      <div className="space-y-6 animate-slide-up">
        <h1 className="text-2xl sm:text-3xl font-bold">Отчеты</h1>

        <Card className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-end">
            <div>
              <Label className="text-xs">Период с</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">по</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9" />
            </div>
            <div className="col-span-2 text-xs text-muted-foreground">
              Всего откликов в системе: <strong>{responsesCount}</strong>
            </div>
          </div>
        </Card>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((stat, index) => (
            <Card key={index}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
                    <p className="text-3xl font-bold">{loading ? '-' : stat.value}</p>
                  </div>
                  <div className={stat.color}>{stat.icon}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="w-5 h-5" /> Заявки по дням
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 w-full">
                {dailyData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                    Нет данных за выбранный период
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Распределение по статусам</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 w-full">
                {statusData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusData} dataKey="value" nameKey="name" outerRadius={80} label>
                        {statusData.map((entry, i) => (
                          <Cell key={i} fill={STATUS_COLORS[entry.status] || '#999'} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                    Нет данных
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="w-5 h-5" /> Экспорт данных
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-4">
              <Button variant="outline" onClick={handleExportRequests} className="h-auto py-4 flex-col items-start gap-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  <span className="font-medium">Экспорт заявок</span>
                </div>
                <p className="text-xs text-muted-foreground text-left">CSV со всеми заявками</p>
              </Button>
              <Button variant="outline" onClick={handleExportWorkers} className="h-auto py-4 flex-col items-start gap-2">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-secondary" />
                  <span className="font-medium">Экспорт исполнителей</span>
                </div>
                <p className="text-xs text-muted-foreground text-left">CSV с базой исполнителей</p>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default AdminReports;
