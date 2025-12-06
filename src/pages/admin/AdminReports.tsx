import React, { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { BarChart3, Download, FileText, Users, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';

const AdminReports: React.FC = () => {
  const [stats, setStats] = useState({ totalRequests: 0, completedRequests: 0, totalWorkers: 0, totalResponses: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      const [requestsRes, workersRes, responsesRes] = await Promise.all([
        supabase.from('requests').select('status'),
        supabase.from('user_roles').select('id').eq('role', 'worker'),
        supabase.from('responses').select('id'),
      ]);
      const requests = requestsRes.data || [];
      setStats({
        totalRequests: requests.length,
        completedRequests: requests.filter(r => r.status === 'completed').length,
        totalWorkers: workersRes.data?.length || 0,
        totalResponses: responsesRes.data?.length || 0,
      });
      setLoading(false);
    };
    fetchStats();
  }, []);

  const handleExportRequests = async () => {
    const { data } = await supabase.from('requests').select('*').order('created_at', { ascending: false });
    if (!data) return;
    const hrIds = [...new Set(data.map(r => r.hr_id))];
    const { data: profiles } = await supabase.from('profiles').select('user_id, company').in('user_id', hrIds);
    const profileMap = new Map(profiles?.map(p => [p.user_id, p.company]) || []);

    const csvContent = [
      ['ID', 'Компания', 'Должность', 'Дата', 'Адрес', 'Кол-во', 'Статус'].join(','),
      ...data.map(r => [r.id, profileMap.get(r.hr_id) || '', r.position, r.start_date, `"${r.address}"`, r.quantity, r.status].join(','))
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
    const { data } = await supabase.from('profiles').select('*').in('user_id', roles.map(r => r.user_id));
    if (!data) return;
    const csvContent = [
      ['ID', 'ФИО', 'Email', 'Телефон', 'Город', 'Рейтинг', 'Статус'].join(','),
      ...data.map(w => [w.id, w.full_name || '', w.email, w.phone || '', w.city || '', w.rating, w.is_active ? 'Активен' : 'Заблокирован'].join(','))
    ].join('\n');
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `workers_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    link.click();
  };

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6 animate-slide-up">
        <h1 className="text-3xl font-bold">Отчеты</h1>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Всего заявок', value: stats.totalRequests, icon: <FileText className="w-6 h-6" />, color: 'text-primary' },
            { label: 'Выполнено', value: stats.completedRequests, icon: <CheckCircle className="w-6 h-6" />, color: 'text-status-success' },
            { label: 'Исполнителей', value: stats.totalWorkers, icon: <Users className="w-6 h-6" />, color: 'text-secondary' },
            { label: 'Откликов', value: stats.totalResponses, icon: <BarChart3 className="w-6 h-6" />, color: 'text-status-orange' },
          ].map((stat, index) => (
            <Card key={index} className={`animate-float-up stagger-${index + 1}`} style={{ opacity: 0 }}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div><p className="text-sm text-muted-foreground mb-1">{stat.label}</p><p className="text-3xl font-bold">{loading ? '-' : stat.value}</p></div>
                  <div className={stat.color}>{stat.icon}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Download className="w-5 h-5" />Экспорт данных</CardTitle></CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-4">
              <Button variant="outline" onClick={handleExportRequests} className="h-auto py-4 flex-col items-start gap-2">
                <div className="flex items-center gap-2"><FileText className="w-5 h-5 text-primary" /><span className="font-medium">Экспорт заявок</span></div>
                <p className="text-xs text-muted-foreground text-left">CSV файл со всеми заявками</p>
              </Button>
              <Button variant="outline" onClick={handleExportWorkers} className="h-auto py-4 flex-col items-start gap-2">
                <div className="flex items-center gap-2"><Users className="w-5 h-5 text-secondary" /><span className="font-medium">Экспорт исполнителей</span></div>
                <p className="text-xs text-muted-foreground text-left">CSV файл с базой исполнителей</p>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default AdminReports;
