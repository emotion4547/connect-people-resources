import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PlusCircle, FileText, Clock, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import PageMeta from '@/components/PageMeta';

interface RequestStats {
  total: number;
  new: number;
  inProgress: number;
}

interface RecentRequest {
  id: string;
  position: string;
  start_date: string;
  status: string;
}

const HRDashboard: React.FC = () => {
  const { profile } = useAuth();
  const [stats, setStats] = useState<RequestStats>({ total: 0, new: 0, inProgress: 0 });
  const [recentRequests, setRecentRequests] = useState<RecentRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: requests } = await supabase
          .from('requests')
          .select('id, position, start_date, status')
          .order('created_at', { ascending: false });

        if (requests) {
          setRecentRequests(requests.slice(0, 5));
          setStats({
            total: requests.length,
            new: requests.filter(r => r.status === 'new').length,
            inProgress: requests.filter(r => r.status === 'in_progress').length,
          });
        }
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; className: string }> = {
      new: { label: 'Новая', className: 'bg-status-orange/20 text-status-orange' },
      in_progress: { label: 'В работе', className: 'bg-primary/20 text-primary' },
      assigned: { label: 'Назначено', className: 'bg-status-gold/20 text-secondary' },
      completed: { label: 'Выполнено', className: 'bg-status-success/20 text-status-success' },
      cancelled: { label: 'Отменена', className: 'bg-status-gray/20 text-muted-foreground' },
    };
    const variant = variants[status] || variants.new;
    return <Badge className={variant.className}>{variant.label}</Badge>;
  };

  return (
    <DashboardLayout role="hr">
      <PageMeta title="HR Дашборд" description="Управление заявками на персонал в системе Люди и Ресурсы" />
      <div className="space-y-6">
        {/* Welcome */}
        <div className="animate-slide-up">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2 break-words">
            Добро пожаловать, {profile?.company || profile?.full_name || 'Пользователь'}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Управляйте заявками на персонал в одном месте
          </p>
        </div>

        {/* Stats */}
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            { label: 'Активные заявки', value: stats.total, icon: <FileText className="w-5 h-5" />, color: 'text-primary' },
            { label: 'Новые заявки сегодня', value: stats.new, icon: <Clock className="w-5 h-5" />, color: 'text-status-orange' },
            { label: 'Заявки в работе', value: stats.inProgress, icon: <CheckCircle className="w-5 h-5" />, color: 'text-status-success' },
          ].map((stat, index) => (
            <Card key={index} className={`animate-float-up stagger-${index + 1} card-hover`} style={{ opacity: 0 }}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
                    <p className="text-3xl font-bold">{loading ? '-' : stat.value}</p>
                  </div>
                  <div className={`${stat.color}`}>{stat.icon}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Create button */}
        <div className="pt-2">
          <Link to="/hr/create-request">
            <Button size="lg" className="btn-hover gap-2">
              <PlusCircle className="w-5 h-5" />
              Создать заявку
            </Button>
          </Link>
        </div>

        {/* Recent requests */}
        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Ближайшие заявки
              <Link to="/hr/requests" className="text-sm text-primary hover:underline font-normal">
                Смотреть все
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-12 bg-muted animate-shimmer rounded-lg" />
                ))}
              </div>
            ) : recentRequests.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">ID</th>
                      <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Должность</th>
                      <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Дата</th>
                      <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRequests.map((request) => (
                      <tr key={request.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="py-3 px-2 text-sm font-mono">{request.id.slice(0, 8)}</td>
                        <td className="py-3 px-2">{request.position}</td>
                        <td className="py-3 px-2 text-sm text-muted-foreground">
                          {format(new Date(request.start_date), 'd MMMM', { locale: ru })}
                        </td>
                        <td className="py-3 px-2">{getStatusBadge(request.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>Заявок пока нет</p>
                <Link to="/hr/create-request" className="text-primary hover:underline text-sm">
                  Создать первую заявку
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default HRDashboard;
