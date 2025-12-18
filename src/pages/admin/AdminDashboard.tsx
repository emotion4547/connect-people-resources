import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { FileText, Clock, Users, Mail, AlertTriangle, MapPin, Calendar, TrendingUp, CheckCircle } from 'lucide-react';
import { format, differenceInDays, subDays, startOfDay, eachDayOfInterval } from 'date-fns';
import { ru } from 'date-fns/locale';
import PageMeta from '@/components/PageMeta';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';

interface Stats {
  newRequests: number;
  inProgressRequests: number;
  completedRequests: number;
  todayWorkers: number;
  unreadMessages: number;
  totalWorkers: number;
}

interface UrgentRequest {
  id: string;
  position: string;
  start_date: string;
  address: string;
  quantity: number;
  status: string;
  daysUntil: number;
}

const AdminDashboard: React.FC = () => {
  const [stats, setStats] = useState<Stats>({
    newRequests: 0,
    inProgressRequests: 0,
    completedRequests: 0,
    todayWorkers: 0,
    unreadMessages: 0,
    totalWorkers: 0,
  });
  const [urgentRequests, setUrgentRequests] = useState<UrgentRequest[]>([]);
  const [chartData, setChartData] = useState<{ date: string; requests: number; completed: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];

      const [requestsRes, responsesRes, chatsRes, workersRes] = await Promise.all([
        supabase.from('requests').select('id, status, start_date, position, address, quantity, created_at'),
        supabase.from('responses').select('status').eq('status', 'assigned'),
        supabase.from('support_chats').select('unread_count'),
        supabase.from('user_roles').select('id').eq('role', 'worker'),
      ]);

      const requests = requestsRes.data || [];
      const chats = chatsRes.data || [];
      const workers = workersRes.data || [];

      // Filter urgent requests (2 days or less until start_date, not completed/cancelled)
      const urgent = requests
        .filter(r => {
          if (r.status === 'completed' || r.status === 'cancelled') return false;
          const daysUntil = differenceInDays(new Date(r.start_date), today);
          return daysUntil >= 0 && daysUntil <= 2;
        })
        .map(r => ({
          ...r,
          daysUntil: differenceInDays(new Date(r.start_date), today),
        }))
        .sort((a, b) => a.daysUntil - b.daysUntil);

      setUrgentRequests(urgent);

      // Build chart data for last 7 days
      const days = eachDayOfInterval({
        start: subDays(today, 6),
        end: today,
      });

      const dailyData = days.map(day => {
        const dayStart = startOfDay(day);
        const requestsCount = requests.filter(r => {
          const createdDate = startOfDay(new Date(r.created_at));
          return createdDate.getTime() === dayStart.getTime();
        }).length;
        
        const completedCount = requests.filter(r => {
          const createdDate = startOfDay(new Date(r.created_at));
          return createdDate.getTime() === dayStart.getTime() && r.status === 'completed';
        }).length;

        return {
          date: format(day, 'dd.MM'),
          requests: requestsCount,
          completed: completedCount,
        };
      });

      setChartData(dailyData);

      setStats({
        newRequests: requests.filter(r => r.status === 'new').length,
        inProgressRequests: requests.filter(r => r.status === 'in_progress').length,
        completedRequests: requests.filter(r => r.status === 'completed').length,
        todayWorkers: requests.filter(r => r.start_date === todayStr).reduce((sum, r) => sum + r.quantity, 0),
        unreadMessages: chats.reduce((sum, c) => sum + (c.unread_count || 0), 0),
        totalWorkers: workers.length,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    { label: 'Новые заявки', value: stats.newRequests, icon: <FileText className="w-6 h-6" />, href: '/admin/requests', color: 'text-status-orange' },
    { label: 'В работе', value: stats.inProgressRequests, icon: <Clock className="w-6 h-6" />, href: '/admin/requests', color: 'text-primary' },
    { label: 'Выполнено', value: stats.completedRequests, icon: <CheckCircle className="w-6 h-6" />, href: '/admin/requests', color: 'text-status-success' },
    { label: 'Исполнители', value: stats.totalWorkers, icon: <Users className="w-6 h-6" />, href: '/admin/workers', color: 'text-secondary' },
    { label: 'На смене сегодня', value: stats.todayWorkers, icon: <TrendingUp className="w-6 h-6" />, href: '/admin/workers', color: 'text-primary' },
    { label: 'Сообщения', value: stats.unreadMessages, icon: <Mail className="w-6 h-6" />, href: '/admin/messages', color: 'text-status-orange' },
  ];

  const getUrgencyBadge = (daysUntil: number) => {
    if (daysUntil === 0) {
      return <Badge className="bg-destructive text-destructive-foreground">Сегодня</Badge>;
    } else if (daysUntil === 1) {
      return <Badge className="bg-status-orange text-white">Завтра</Badge>;
    } else {
      return <Badge className="bg-status-gold/20 text-secondary">Через 2 дня</Badge>;
    }
  };

  return (
    <DashboardLayout role="admin">
      <PageMeta title="Панель администратора" description="Административная панель управления системой Работа для Всех" />
      <div className="space-y-6 animate-slide-up">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">Панель администратора</h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Обзор текущей активности системы
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((stat, index) => (
            <Link key={index} to={stat.href}>
              <Card 
                className={`card-hover animate-float-up stagger-${index + 1}`} 
                style={{ opacity: 0 }}
              >
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
                      <p className="text-3xl font-bold">
                        {loading ? '-' : stat.value}
                      </p>
                    </div>
                    <div className={stat.color}>{stat.icon}</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Urgent Requests Section */}
        {urgentRequests.length > 0 && (
          <Card className="border-status-orange/50 animate-fade-in">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-status-orange">
                <AlertTriangle className="w-5 h-5" />
                Срочные заявки ({urgentRequests.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {urgentRequests.slice(0, 5).map((request) => (
                  <Link 
                    key={request.id} 
                    to="/admin/requests"
                    className="flex items-center justify-between p-3 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-medium truncate">{request.position}</span>
                        {getUrgencyBadge(request.daysUntil)}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 flex-shrink-0" />
                          {format(new Date(request.start_date), 'd MMMM', { locale: ru })}
                        </span>
                        <span className="flex items-center gap-1 truncate max-w-[120px] sm:max-w-none">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{request.address}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3 flex-shrink-0" />
                          {request.quantity} чел.
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
                {urgentRequests.length > 5 && (
                  <Link 
                    to="/admin/requests" 
                    className="block text-center text-sm text-primary hover:underline py-2"
                  >
                    Показать все срочные заявки →
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Weekly Activity Charts */}
        <div className="grid lg:grid-cols-2 gap-6">
          <Card className="animate-fade-in">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                Активность за неделю
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-[250px] bg-muted animate-shimmer rounded-lg" />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--status-success))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--status-success))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                      allowDecimals={false}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                      }}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="requests" 
                      name="Создано заявок"
                      stroke="hsl(var(--primary))" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorRequests)" 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="completed" 
                      name="Выполнено"
                      stroke="hsl(var(--status-success))" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorCompleted)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
              <div className="flex justify-center gap-6 mt-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-primary" />
                  <span className="text-sm text-muted-foreground">Создано заявок</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-status-success" />
                  <span className="text-sm text-muted-foreground">Выполнено</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="animate-fade-in">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-secondary" />
                Заявки по дням
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-[250px] bg-muted animate-shimmer rounded-lg" />
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={chartData}>
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                      allowDecimals={false}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                      }}
                      labelStyle={{ color: 'hsl(var(--foreground))' }}
                      cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3 }}
                    />
                    <Bar 
                      dataKey="requests" 
                      name="Заявки"
                      fill="hsl(var(--primary))" 
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar 
                      dataKey="completed" 
                      name="Выполнено"
                      fill="hsl(var(--status-success))" 
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
              <div className="flex justify-center gap-6 mt-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-primary" />
                  <span className="text-sm text-muted-foreground">Заявки</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-status-success" />
                  <span className="text-sm text-muted-foreground">Выполнено</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick actions */}
        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle>Быстрые действия</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Link to="/admin/requests" className="p-4 bg-muted rounded-xl hover:bg-muted/80 transition-colors">
                <FileText className="w-6 h-6 sm:w-8 sm:h-8 text-primary mb-2" />
                <p className="font-medium text-sm sm:text-base">Обработать заявки</p>
                <p className="text-xs sm:text-sm text-muted-foreground">Новые заявки ждут обработки</p>
              </Link>
              <Link to="/admin/messages" className="p-4 bg-muted rounded-xl hover:bg-muted/80 transition-colors">
                <Mail className="w-6 h-6 sm:w-8 sm:h-8 text-secondary mb-2" />
                <p className="font-medium text-sm sm:text-base">Ответить на сообщения</p>
                <p className="text-xs sm:text-sm text-muted-foreground">Есть непрочитанные обращения</p>
              </Link>
              <Link to="/admin/settings" className="p-4 bg-muted rounded-xl hover:bg-muted/80 transition-colors">
                <Users className="w-6 h-6 sm:w-8 sm:h-8 text-status-success mb-2" />
                <p className="font-medium text-sm sm:text-base">Настроить webhook</p>
                <p className="text-xs sm:text-sm text-muted-foreground">Автопубликация в соцсети</p>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default AdminDashboard;
