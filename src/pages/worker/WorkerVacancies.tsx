import React, { useEffect, useState, useMemo } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { MapPin, Calendar, Clock, Banknote, Briefcase, Search, RotateCcw, MessageCircle } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import PageMeta from '@/components/PageMeta';

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

const POSITIONS = [
  'Сортировщик',
  'Упаковщик',
  'Грузчик',
  'Комплектовщик',
  'Кладовщик',
  'Водитель погрузчика',
  'Разнорабочий',
];

const WorkerVacancies: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  // Filters
  const [searchFilter, setSearchFilter] = useState('');
  const [positionFilter, setPositionFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');

  useEffect(() => {
    fetchData();
  }, [user]);

  const fetchData = async () => {
    if (!user) return;

    try {
      const { data: requests } = await supabase
        .from('requests')
        .select('*')
        .in('status', ['new', 'in_progress'])
        .order('start_date', { ascending: true });

      setVacancies(requests || []);

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

  // Filter logic
  const filteredVacancies = useMemo(() => {
    return vacancies.filter(v => {
      if (searchFilter) {
        const search = searchFilter.toLowerCase();
        const matchPosition = v.position.toLowerCase().includes(search);
        const matchAddress = v.address.toLowerCase().includes(search);
        if (!matchPosition && !matchAddress) return false;
      }
      if (positionFilter !== 'all' && v.position !== positionFilter) return false;
      if (dateFilter && v.start_date !== dateFilter) return false;
      return true;
    });
  }, [vacancies, searchFilter, positionFilter, dateFilter]);

  const resetFilters = () => {
    setSearchFilter('');
    setPositionFilter('all');
    setDateFilter('');
  };

  const hasActiveFilters = searchFilter || positionFilter !== 'all' || dateFilter;

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

  const handleContactSupport = (vacancyId: string) => {
    navigate(`/worker/support?request_id=${vacancyId}`);
  };

  return (
    <DashboardLayout role="worker">
      <PageMeta title="Доступные смены" description="Найдите подходящие вакансии и смены в системе Люди и Ресурсы" />
      <div className="space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Доступные смены</h1>
          <p className="text-muted-foreground">
            Выберите подходящую вакансию и откликнитесь
          </p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              <div className="sm:col-span-2 lg:col-span-1">
                <label className="text-sm font-medium mb-1 block text-muted-foreground">Поиск</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Должность или адрес"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block text-muted-foreground">Должность</label>
                <Select value={positionFilter} onValueChange={setPositionFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Все должности" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все должности</SelectItem>
                    {POSITIONS.map(pos => (
                      <SelectItem key={pos} value={pos}>{pos}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block text-muted-foreground">Дата</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="date"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              {hasActiveFilters && (
                <div className="flex items-end">
                  <Button variant="outline" onClick={resetFilters} className="w-full gap-2">
                    <RotateCcw className="w-4 h-4" />
                    Сбросить
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-64 bg-muted animate-shimmer rounded-2xl" />
            ))}
          </div>
        ) : filteredVacancies.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredVacancies.map((vacancy, index) => (
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

                  {/* Buttons */}
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 btn-hover"
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
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => handleContactSupport(vacancy.id)}
                      title="Связаться с поддержкой"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="py-12">
            <CardContent className="text-center">
              <Briefcase className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground">
                {hasActiveFilters ? 'Нет вакансий по заданным фильтрам' : 'Пока нет доступных смен'}
              </p>
              {hasActiveFilters && (
                <Button variant="link" onClick={resetFilters} className="mt-2">
                  Сбросить фильтры
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
};

export default WorkerVacancies;