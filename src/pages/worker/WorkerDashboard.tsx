import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  Calendar,
  Clock,
  MapPin,
  Banknote,
  Briefcase,
  CheckCircle2,
  TrendingUp,
  ArrowRight,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import PageMeta from '@/components/PageMeta';

interface NextShift {
  position: string;
  start_date: string;
  start_time: string | null;
  end_time: string | null;
  address: string;
  pay: string | null;
}

const WorkerDashboard: React.FC = () => {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [nextShift, setNextShift] = useState<NextShift | null>(null);
  const [counts, setCounts] = useState({ pending: 0, assigned: 0, completed: 0 });

  useEffect(() => {
    if (!user) return;
    void fetchData();
  }, [user]);

  const fetchData = async () => {
    if (!user) return;
    try {
      const { data: responses } = await supabase
        .from('responses')
        .select('status, request_id')
        .eq('worker_id', user.id);

      const pending = responses?.filter((r) => r.status === 'pending').length || 0;
      const assigned = responses?.filter((r) => r.status === 'assigned').length || 0;
      const completed = responses?.filter((r) => r.status === 'completed').length || 0;
      setCounts({ pending, assigned, completed });

      const assignedIds =
        responses?.filter((r) => r.status === 'assigned').map((r) => r.request_id) || [];

      if (assignedIds.length > 0) {
        const today = new Date().toISOString().slice(0, 10);
        const { data: req } = await supabase
          .from('requests')
          .select('position, start_date, start_time, end_time, address, pay')
          .in('id', assignedIds)
          .gte('start_date', today)
          .order('start_date', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (req) setNextShift(req as NextShift);
      }
    } catch (e) {
      console.error('Error loading worker dashboard:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout role="worker">
      <PageMeta
        title="Главная"
        description="Сводка по сменам и откликам в системе Работа для Всех"
      />
      <div className="space-y-6 animate-slide-up">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold mb-2 break-words">
            Здравствуйте, {profile?.full_name?.split(' ')[0] || 'Исполнитель'}
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Краткая сводка по вашим сменам и откликам
          </p>
        </div>

        {/* Next shift */}
        <Card className="border-secondary/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Calendar className="w-5 h-5 text-primary" />
              Ближайшая смена
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-20 bg-muted animate-shimmer rounded-lg" />
            ) : nextShift ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Briefcase className="w-6 h-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-lg">{nextShift.position}</p>
                    <p className="text-sm text-muted-foreground">
                      {format(new Date(nextShift.start_date), 'd MMMM yyyy, EEEE', { locale: ru })}
                    </p>
                  </div>
                </div>
                <div className="grid sm:grid-cols-3 gap-2 text-sm">
                  {nextShift.start_time && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Clock className="w-4 h-4 text-secondary" />
                      <span>
                        {nextShift.start_time.slice(0, 5)}
                        {nextShift.end_time && ` – ${nextShift.end_time.slice(0, 5)}`}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-muted-foreground sm:col-span-2">
                    <MapPin className="w-4 h-4 text-secondary" />
                    <span className="truncate">{nextShift.address}</span>
                  </div>
                  {nextShift.pay && (
                    <div className="flex items-center gap-2 font-medium text-status-success">
                      <Banknote className="w-4 h-4" />
                      <span>{nextShift.pay}</span>
                    </div>
                  )}
                </div>
                <Button asChild variant="outline" size="sm" className="gap-2">
                  <Link to="/worker/calendar">
                    Открыть календарь
                    <ArrowRight className="w-4 h-4" />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <Calendar className="w-10 h-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm mb-3">Назначенных смен пока нет</p>
                <Button asChild size="sm">
                  <Link to="/worker/vacancies">Посмотреть доступные смены</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Counters */}
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            {
              label: 'На рассмотрении',
              value: counts.pending,
              icon: <TrendingUp className="w-5 h-5" />,
              color: 'text-status-orange',
              to: '/worker/responses',
            },
            {
              label: 'Назначено',
              value: counts.assigned,
              icon: <CheckCircle2 className="w-5 h-5" />,
              color: 'text-status-success',
              to: '/worker/calendar',
            },
            {
              label: 'Выполнено',
              value: counts.completed,
              icon: <Briefcase className="w-5 h-5" />,
              color: 'text-secondary',
              to: '/worker/responses',
            },
          ].map((stat) => (
            <Link key={stat.label} to={stat.to}>
              <Card className="card-hover h-full">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
                      <p className="text-3xl font-bold">{loading ? '—' : stat.value}</p>
                    </div>
                    <div className={stat.color}>{stat.icon}</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        {/* Quick actions */}
        <div className="flex flex-wrap gap-3">
          <Button asChild className="gap-2">
            <Link to="/worker/vacancies">
              <Briefcase className="w-4 h-4" />
              Доступные смены
            </Link>
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <Link to="/worker/responses">
              <CheckCircle2 className="w-4 h-4" />
              Мои отклики
            </Link>
          </Button>
          <Badge variant="outline" className="hidden sm:inline-flex items-center gap-1 self-center">
            Совет: чем полнее анкета, тем больше предложений
          </Badge>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default WorkerDashboard;
