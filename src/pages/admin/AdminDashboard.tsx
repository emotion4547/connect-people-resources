import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { FileText, Clock, Users, Mail } from 'lucide-react';

interface Stats {
  newRequests: number;
  inProgressRequests: number;
  todayWorkers: number;
  unreadMessages: number;
}

const AdminDashboard: React.FC = () => {
  const [stats, setStats] = useState<Stats>({
    newRequests: 0,
    inProgressRequests: 0,
    todayWorkers: 0,
    unreadMessages: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const today = new Date().toISOString().split('T')[0];

      const [requestsRes, responsesRes, chatsRes] = await Promise.all([
        supabase.from('requests').select('status, start_date'),
        supabase.from('responses').select('status').eq('status', 'assigned'),
        supabase.from('support_chats').select('unread_count'),
      ]);

      const requests = requestsRes.data || [];
      const responses = responsesRes.data || [];
      const chats = chatsRes.data || [];

      setStats({
        newRequests: requests.filter(r => r.status === 'new').length,
        inProgressRequests: requests.filter(r => r.status === 'in_progress').length,
        todayWorkers: requests.filter(r => r.start_date === today).length * 2, // Approximate
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

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Панель администратора</h1>
          <p className="text-muted-foreground">
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

        {/* Quick actions */}
        <Card className="animate-fade-in">
          <CardHeader>
            <CardTitle>Быстрые действия</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-3 gap-4">
              <Link to="/admin/requests" className="p-4 bg-muted rounded-xl hover:bg-muted/80 transition-colors">
                <FileText className="w-8 h-8 text-primary mb-2" />
                <p className="font-medium">Обработать заявки</p>
                <p className="text-sm text-muted-foreground">Новые заявки ждут обработки</p>
              </Link>
              <Link to="/admin/messages" className="p-4 bg-muted rounded-xl hover:bg-muted/80 transition-colors">
                <Mail className="w-8 h-8 text-secondary mb-2" />
                <p className="font-medium">Ответить на сообщения</p>
                <p className="text-sm text-muted-foreground">Есть непрочитанные обращения</p>
              </Link>
              <Link to="/admin/settings" className="p-4 bg-muted rounded-xl hover:bg-muted/80 transition-colors">
                <Users className="w-8 h-8 text-status-success mb-2" />
                <p className="font-medium">Настроить webhook</p>
                <p className="text-sm text-muted-foreground">Автопубликация в соцсети</p>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default AdminDashboard;
