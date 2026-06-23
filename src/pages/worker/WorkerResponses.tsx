import React, { useEffect, useState, useMemo } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { FileText, RotateCcw, MessageCircle, X } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import PageMeta from '@/components/PageMeta';

interface Response {
  id: string;
  status: string;
  created_at: string;
  request_id: string;
  requests: {
    position: string;
    start_date: string;
    address: string;
    pay: string | null;
  };
}

const WorkerResponses: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [responses, setResponses] = useState<Response[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<Response | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    if (user) {
      fetchResponses();
    }
  }, [user]);

  const fetchResponses = async () => {
    if (!user) return;

    try {
      // First get responses
      const { data: responsesData, error: responsesError } = await supabase
        .from('responses')
        .select('id, status, created_at, request_id')
        .eq('worker_id', user.id)
        .order('created_at', { ascending: false });

      if (responsesError) throw responsesError;

      if (!responsesData?.length) {
        setResponses([]);
        setLoading(false);
        return;
      }

      // Then get request details separately
      const requestIds = responsesData.map(r => r.request_id);
      const { data: requestsData, error: requestsError } = await supabase
        .from('requests')
        .select('id, position, start_date, address, pay')
        .in('id', requestIds);

      if (requestsError) throw requestsError;

      // Combine data
      const requestsMap = new Map(requestsData?.map(r => [r.id, r]) || []);
      const combinedData = responsesData.map(response => ({
        ...response,
        requests: requestsMap.get(response.request_id) || {
          position: 'Неизвестно',
          start_date: new Date().toISOString(),
          address: '-',
          pay: null,
        },
      }));

      setResponses(combinedData);
    } catch (error) {
      console.error('Error fetching responses:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter logic
  const filteredResponses = useMemo(() => {
    if (statusFilter === 'all') return responses;
    return responses.filter(r => r.status === statusFilter);
  }, [responses, statusFilter]);

  const resetFilters = () => {
    setStatusFilter('all');
  };

  const hasActiveFilters = statusFilter !== 'all';

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; className: string }> = {
      pending: { label: 'Рассматривается', className: 'bg-status-orange/20 text-status-orange' },
      assigned: { label: 'Назначен', className: 'bg-status-success/20 text-status-success' },
      rejected: { label: 'Отклонён', className: 'bg-destructive/20 text-destructive' },
      completed: { label: 'Выполнено', className: 'bg-status-gold/20 text-secondary' },
      no_show: { label: 'Не вышел', className: 'bg-status-gray/20 text-muted-foreground' },
    };
    const variant = variants[status] || variants.pending;
    return <Badge className={variant.className}>{variant.label}</Badge>;
  };

  const handleContactSupport = (requestId: string) => {
    navigate(`/worker/support?request_id=${requestId}`);
  };

  const confirmCancel = async () => {
    if (!cancelTarget || !user) return;
    setCancelling(true);
    try {
      const { error } = await supabase
        .from('responses')
        .delete()
        .eq('id', cancelTarget.id)
        .eq('worker_id', user.id)
        .eq('status', 'pending');
      if (error) throw error;
      setResponses((prev) => prev.filter((r) => r.id !== cancelTarget.id));
      toast({ title: 'Отклик отменён' });
    } catch (e: any) {
      console.error('Error cancelling response:', e);
      toast({
        title: 'Не удалось отменить',
        description: e?.message || 'Попробуйте позже',
        variant: 'destructive',
      });
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  };

  return (
    <DashboardLayout role="worker">
      <PageMeta title="Мои отклики" description="История откликов на вакансии" />
      <div className="space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Мои отклики</h1>
          <p className="text-muted-foreground">
            История ваших откликов на вакансии
          </p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="w-[200px]">
                <label className="text-sm font-medium mb-1 block text-muted-foreground">Статус</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Все статусы" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все статусы</SelectItem>
                    <SelectItem value="pending">Рассматривается</SelectItem>
                    <SelectItem value="assigned">Назначен</SelectItem>
                    <SelectItem value="rejected">Отклонён</SelectItem>
                    <SelectItem value="completed">Выполнено</SelectItem>
                    <SelectItem value="no_show">Не вышел</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {hasActiveFilters && (
                <Button variant="outline" onClick={resetFilters} className="gap-2">
                  <RotateCcw className="w-4 h-4" />
                  Сбросить
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 bg-muted animate-shimmer rounded-lg" />
                ))}
              </div>
            ) : filteredResponses.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Должность</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Дата смены</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Адрес</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Оплата</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Статус</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResponses.map((response) => (
                      <tr key={response.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-4 px-4 font-medium">{response.requests.position}</td>
                        <td className="py-4 px-4 text-sm text-muted-foreground">
                          {format(new Date(response.requests.start_date), 'd MMMM yyyy', { locale: ru })}
                        </td>
                        <td className="py-4 px-4 text-sm max-w-[200px] truncate">
                          {response.requests.address}
                        </td>
                        <td className="py-4 px-4 text-sm">
                          {response.requests.pay || '-'}
                        </td>
                        <td className="py-4 px-4">{getStatusBadge(response.status)}</td>
                        <td className="py-4 px-4">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleContactSupport(response.request_id)}
                              className="gap-1"
                            >
                              <MessageCircle className="w-4 h-4" />
                              <span className="hidden sm:inline">Поддержка</span>
                            </Button>
                            {response.status === 'pending' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCancelTarget(response)}
                                className="gap-1 text-destructive hover:text-destructive"
                              >
                                <X className="w-4 h-4" />
                                <span className="hidden sm:inline">Отменить</span>
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground mb-2">
                  {hasActiveFilters ? 'Нет откликов по заданному фильтру' : 'Откликов пока нет'}
                </p>
                {!hasActiveFilters && (
                  <p className="text-sm text-muted-foreground">
                    Откликнитесь на вакансию в разделе "Доступные смены"
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default WorkerResponses;