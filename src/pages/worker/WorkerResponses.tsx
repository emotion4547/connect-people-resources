import React, { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { FileText } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface Response {
  id: string;
  status: string;
  created_at: string;
  requests: {
    position: string;
    start_date: string;
    address: string;
    pay: string | null;
  };
}

const WorkerResponses: React.FC = () => {
  const { user } = useAuth();
  const [responses, setResponses] = useState<Response[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchResponses();
    }
  }, [user]);

  const fetchResponses = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('responses')
        .select(`
          id,
          status,
          created_at,
          requests (
            position,
            start_date,
            address,
            pay
          )
        `)
        .eq('worker_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setResponses(data || []);
    } catch (error) {
      console.error('Error fetching responses:', error);
    } finally {
      setLoading(false);
    }
  };

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

  return (
    <DashboardLayout role="worker">
      <div className="space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Мои отклики</h1>
          <p className="text-muted-foreground">
            История ваших откликов на вакансии
          </p>
        </div>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 bg-muted animate-shimmer rounded-lg" />
                ))}
              </div>
            ) : responses.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Должность</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Дата смены</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Адрес</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Оплата</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {responses.map((response) => (
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground mb-2">Откликов пока нет</p>
                <p className="text-sm text-muted-foreground">
                  Откликнитесь на вакансию в разделе "Доступные смены"
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default WorkerResponses;
