import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { FileText, Clock, Users, Mail, AlertTriangle, MapPin, Calendar } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { ru } from 'date-fns/locale';

interface Stats {
  newRequests: number;
  inProgressRequests: number;
  todayWorkers: number;
  unreadMessages: number;
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
    todayWorkers: 0,
    unreadMessages: 0,
  });
  const [urgentRequests, setUrgentRequests] = useState<UrgentRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];

      const [requestsRes, responsesRes, chatsRes] = await Promise.all([
        supabase.from('requests').select('id, status, start_date, position, address, quantity'),
        supabase.from('responses').select('status').eq('status', 'assigned'),
        supabase.from('support_chats').select('unread_count'),
      ]);

      const requests = requestsRes.data || [];
      const chats = chatsRes.data || [];

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

      setStats({
        newRequests: requests.filter(r => r.status === 'new').length,
        inProgressRequests: requests.filter(r => r.status === 'in_progress').length,
        todayWorkers: requests.filter(r => r.start_date === todayStr).length * 2,
        unreadMessages: chats.reduce((sum, c) => sum + (c.unread_count || 0), 0),
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    { label: 'Новые заявки', value: stats.newRequests, icon: <FileText className="w-6 h-6" />, href: '/admin/requests', color: 'text-status-orange' },
    { label: 'Заявки в работе', value: stats.inProgressRequests, icon: <Clock className="w-6 h-6" />, href: '/admin/requests', color: 'text-primary' },
    { label: 'Сегодня на смене', value: stats.todayWorkers, icon: <Users className="w-6 h-6" />, href: '/admin/workers', color: 'text-status-success' },
    { label: 'Непрочитанные сообщения', value: stats.unreadMessages, icon: <Mail className="w-6 h-6" />, href: '/admin/messages', color: 'text-secondary' },
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
