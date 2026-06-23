import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PlusCircle, FileText, Clock, CheckCircle, TrendingUp } from 'lucide-react';
import { format, subDays, startOfDay, eachDayOfInterval } from 'date-fns';
import { ru } from 'date-fns/locale';
import PageMeta from '@/components/PageMeta';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface RequestStats {
  total: number;
  new: number;
  inProgress: number;
  completed: number;
}

interface RecentRequest {
  id: string;
  position: string;
  start_date: string;
  status: string;
  created_at: string;
}

const HRDashboard: React.FC = () => {
  const { profile } = useAuth();
  const [stats, setStats] = useState<RequestStats>({ total: 0, new: 0, inProgress: 0, completed: 0 });
  const [recentRequests, setRecentRequests] = useState<RecentRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState<{ date: string; count: number }[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data: requests } = await supabase
          .from('requests')
          .select('id, position, start_date, status, created_at')
          .order('created_at', { ascending: false })
          .limit(500);

        const { data: upcoming } = await supabase
          .from('requests')
          .select('id, position, start_date, status, created_at')
          .gte('start_date', new Date().toISOString().slice(0, 10))
          .order('start_date', { ascending: true })
          .limit(5);

        if (requests) {
          setRecentRequests(upcoming || []);
          setStats({
            total: requests.length,
            new: requests.filter(r => r.status === 'new').length,
            inProgress: requests.filter(r => r.status === 'in_progress').length,
            completed: requests.filter(r => r.status === 'completed').length,
          });

          // Build chart data for last 7 days
          const today = new Date();
          const days = eachDayOfInterval({
            start: subDays(today, 6),
            end: today,
          });

          const dailyCounts = days.map(day => {
            const dayStart = startOfDay(day);
            const count = requests.filter(r => {
              const createdDate = startOfDay(new Date(r.created_at));
              return createdDate.getTime() === dayStart.getTime();
            }).length;

            return {
              date: format(day, 'dd.MM'),
              count,
            };
          });

          setChartData(dailyCounts);
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
      <PageMeta title="HR Дашборд" description="Управление заявками на персонал в системе Работа для Всех" />
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
        <div className="grid sm:grid-cols-4 gap-4">
          {[
            { label: 'Всего заявок', value: stats.total, icon: <FileText className="w-5 h-5" />, color: 'text-primary' },
            { label: 'Новые', value: stats.new, icon: <Clock className="w-5 h-5" />, color: 'text-status-orange' },
            { label: 'В работе', value: stats.inProgress, icon: <TrendingUp className="w-5 h-5" />, color: 'text-secondary' },
            { label: 'Выполнено', value: stats.completed, icon: <CheckCircle className="w-5 h-5" />, color: 'text-status-success' },
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

        {/* Charts */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Area chart - requests over time */}
          <Card className="animate-fade-in">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                Заявки за неделю
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-48 bg-muted animate-shimmer rounded-lg" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      allowDecimals={false}
                    />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="count" 
                      stroke="hsl(var(--primary))" 
                      fillOpacity={1} 
                      fill="url(#colorCount)"
                      strokeWidth={2}
                      name="Заявок"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Pie chart - status distribution */}
          <Card className="animate-fade-in">
            <CardHeader>
              <CardTitle>Распределение по статусам</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-48 bg-muted animate-shimmer rounded-lg" />
              ) : stats.total === 0 ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground">
                  Нет данных
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="50%" height={200}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Новые', value: stats.new, color: 'hsl(var(--status-orange))' },
                          { name: 'В работе', value: stats.inProgress, color: 'hsl(var(--secondary))' },
                          { name: 'Выполнено', value: stats.completed, color: 'hsl(var(--status-success))' },
                        ].filter(d => d.value > 0)}
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={70}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {[
                          { name: 'Новые', value: stats.new, color: '#f97316' },
                          { name: 'В работе', value: stats.inProgress, color: '#eab308' },
                          { name: 'Выполнено', value: stats.completed, color: '#22c55e' },
                        ].filter(d => d.value > 0).map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-[#f97316]" />
                      <span className="text-sm">Новые: {stats.new}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-[#eab308]" />
                      <span className="text-sm">В работе: {stats.inProgress}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-[#22c55e]" />
                      <span className="text-sm">Выполнено: {stats.completed}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
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
