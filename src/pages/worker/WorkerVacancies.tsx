import React, { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { MapPin, Calendar, Clock, Banknote, Briefcase } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface Vacancy {
  id: string;
  position: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  address: string;
  quantity: number;
  requirements: string | null;
  pay: string | null;
  status: string;
}

const WorkerVacancies: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, [user]);

  const fetchData = async () => {
    if (!user) return;

    try {
      // Fetch available vacancies
      const { data: requests } = await supabase
        .from('requests')
        .select('*')
        .in('status', ['new', 'in_progress'])
        .order('start_date', { ascending: true });

      setVacancies(requests || []);

      // Fetch user's responses
      const { data: responses } = await supabase
        .from('responses')
        .select('request_id')
        .eq('worker_id', user.id);

      if (responses) {
        setAppliedIds(new Set(responses.map(r => r.request_id)));
      }
    } catch (error) {
      console.error('Error fetching vacancies:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (vacancyId: string) => {
    if (!user) return;

    setApplyingId(vacancyId);
    try {
      const { error } = await supabase.from('responses').insert({
        request_id: vacancyId,
        worker_id: user.id,
        status: 'pending',
      });

      if (error) {
        if (error.code === '23505') {
          toast({
            title: 'Вы уже откликнулись',
            description: 'Вы уже отправляли отклик на эту вакансию',
            variant: 'destructive',
          });
        } else {
          throw error;
        }
        return;
      }

      setAppliedIds(new Set([...appliedIds, vacancyId]));
      toast({
        title: 'Отклик отправлен!',
        description: 'Ожидайте ответа от менеджера',
      });
    } catch (error) {
      console.error('Error applying:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось отправить отклик',
        variant: 'destructive',
      });
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <DashboardLayout role="worker">
      <div className="space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Доступные смены</h1>
          <p className="text-muted-foreground">
            Выберите подходящую вакансию и откликнитесь
          </p>
        </div>

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-64 bg-muted animate-shimmer rounded-2xl" />
            ))}
          </div>
        ) : vacancies.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vacancies.map((vacancy, index) => (
              <Card
                key={vacancy.id}
                className={`card-hover animate-float-up stagger-${(index % 5) + 1} border-secondary/20`}
                style={{ opacity: 0 }}
              >
                <CardContent className="pt-6">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Briefcase className="w-6 h-6 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg">{vacancy.position}</h3>
                        <Badge variant="secondary" className="text-xs">
                          {vacancy.quantity} {vacancy.quantity === 1 ? 'место' : 'мест'}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="w-4 h-4 text-secondary" />
                      <span>
                        {format(new Date(vacancy.start_date), 'd MMMM', { locale: ru })}
                        {vacancy.start_date !== vacancy.end_date && (
                          <> - {format(new Date(vacancy.end_date), 'd MMMM', { locale: ru })}</>
                        )}
                      </span>
                    </div>
                    {vacancy.start_time && vacancy.end_time && (
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="w-4 h-4 text-secondary" />
                        <span>{vacancy.start_time.slice(0, 5)} - {vacancy.end_time.slice(0, 5)}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="w-4 h-4 text-secondary" />
                      <span className="truncate">{vacancy.address}</span>
                    </div>
                    {vacancy.pay && (
                      <div className="flex items-center gap-2 text-sm font-medium text-status-success">
                        <Banknote className="w-4 h-4" />
                        <span>{vacancy.pay}</span>
                      </div>
                    )}
                  </div>

                  {/* Requirements */}
                  {vacancy.requirements && (
                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                      {vacancy.requirements}
                    </p>
                  )}

                  {/* Button */}
                  <Button
                    className="w-full btn-hover"
                    disabled={appliedIds.has(vacancy.id) || applyingId === vacancy.id}
                    onClick={() => handleApply(vacancy.id)}
                  >
                    {applyingId === vacancy.id ? (
                      <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    ) : appliedIds.has(vacancy.id) ? (
                      'Вы откликнулись'
                    ) : (
                      'Откликнуться'
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="py-12">
            <CardContent className="text-center">
              <Briefcase className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground">
                Пока нет доступных смен
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Новые вакансии появятся здесь
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
};

export default WorkerVacancies;
