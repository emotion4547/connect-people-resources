import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { PlusCircle, Eye, CheckCircle, FileText, ThumbsUp, Filter, X, MessageCircle, User } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface Request {
  id: string;
  position: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  address: string;
  quantity: number;
  requirements: string | null;
  comments: string | null;
  pay: string | null;
  status: string;
  webhook_sent: boolean;
  created_at: string;
}

interface Response {
  id: string;
  worker_id: string;
  status: string;
  worker_profile?: {
    full_name: string | null;
    phone: string | null;
    city: string | null;
    experience: string | null;
    rating: number | null;
  };
}

const statusFilters = [
  { id: 'all', label: 'Все' },
  { id: 'new', label: 'Новые' },
  { id: 'in_progress', label: 'В работе' },
  { id: 'assigned', label: 'Назначено' },
  { id: 'pending_confirmation', label: 'Ожидает подтверждения' },
  { id: 'completed', label: 'Выполнено' },
];

const HRRequests: React.FC = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [assignedWorkers, setAssignedWorkers] = useState<Response[]>([]);
  
  // Additional filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [payFilter, setPayFilter] = useState('');

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRequests(data || []);
    } catch (error) {
      console.error('Error fetching requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAssignedWorkers = async (requestId: string) => {
    const { data } = await supabase
      .from('responses')
      .select('id, worker_id, status')
      .eq('request_id', requestId)
      .eq('status', 'assigned');
    
    if (data && data.length > 0) {
      const workerIds = data.map(r => r.worker_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, phone, city, experience, rating')
        .in('user_id', workerIds);
      
      const workersWithProfiles = data.map(resp => ({
        ...resp,
        worker_profile: profiles?.find(p => p.user_id === resp.worker_id)
      }));
      
      setAssignedWorkers(workersWithProfiles);
    } else {
      setAssignedWorkers([]);
    }
  };

  const handleViewDetails = async (request: Request) => {
    setSelectedRequest(request);
    await fetchAssignedWorkers(request.id);
  };

  const handleConfirmCompletion = async (requestId: string) => {
    setConfirmingId(requestId);
    try {
      const { error } = await supabase
        .from('requests')
        .update({ status: 'completed' as any })
        .eq('id', requestId);

      if (error) throw error;

      setRequests(requests.map(r =>
        r.id === requestId ? { ...r, status: 'completed' } : r
      ));

      if (selectedRequest?.id === requestId) {
        setSelectedRequest({ ...selectedRequest, status: 'completed' });
      }

      toast({
        title: 'Заявка подтверждена',
        description: 'Заявка отмечена как выполненная',
      });
    } catch (error) {
      console.error('Error confirming request:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось подтвердить выполнение',
        variant: 'destructive',
      });
    } finally {
      setConfirmingId(null);
    }
  };

  const handleContactSupport = async (request: Request) => {
    if (!user) return;
    
    try {
      // Check for existing chat for this request
      let { data: existingChat } = await supabase
        .from('support_chats')
        .select('id')
        .eq('user_id', user.id)
        .eq('request_id', request.id)
        .maybeSingle();

      if (!existingChat) {
        const { data: newChat, error } = await supabase
          .from('support_chats')
          .insert({
            user_id: user.id,
            user_type: 'hr',
            request_id: request.id,
          })
          .select()
          .single();

        if (error) throw error;
        existingChat = newChat;
      }

      // Navigate to support with request context
      window.location.href = `/hr/support?request=${request.id}`;
    } catch (error) {
      console.error('Error creating support chat:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось открыть чат поддержки',
        variant: 'destructive',
      });
    }
  };

  const hasFilters = activeFilter !== 'all' || dateFrom || dateTo || payFilter;

  const clearFilters = () => {
    setActiveFilter('all');
    setDateFrom('');
    setDateTo('');
    setPayFilter('');
  };

  const filteredRequests = requests.filter(r => {
    if (activeFilter !== 'all' && r.status !== activeFilter) return false;
    if (dateFrom && r.start_date < dateFrom) return false;
    if (dateTo && r.start_date > dateTo) return false;
    if (payFilter && r.pay && !r.pay.toLowerCase().includes(payFilter.toLowerCase())) return false;
    return true;
  });

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; className: string }> = {
      new: { label: 'Новая', className: 'bg-status-orange/20 text-status-orange' },
      in_progress: { label: 'В работе', className: 'bg-primary/20 text-primary' },
      assigned: { label: 'Назначено', className: 'bg-status-gold/20 text-secondary' },
      pending_confirmation: { label: 'Ожидает подтверждения', className: 'bg-purple-500/20 text-purple-600' },
      completed: { label: 'Выполнено', className: 'bg-status-success/20 text-status-success' },
      cancelled: { label: 'Отменена', className: 'bg-status-gray/20 text-muted-foreground' },
    };
    const variant = variants[status] || variants.new;
    return <Badge className={variant.className}>{variant.label}</Badge>;
  };

  return (
    <DashboardLayout role="hr">
      <div className="space-y-6 animate-slide-up">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h1 className="text-3xl font-bold">Мои заявки</h1>
          <Link to="/hr/create-request">
            <Button className="btn-hover gap-2">
              <PlusCircle className="w-4 h-4" />
              Создать заявку
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <Card className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-wrap gap-2">
              {statusFilters.map((filter) => (
                <Button
                  key={filter.id}
                  variant={activeFilter === filter.id ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveFilter(filter.id)}
                  className="rounded-full"
                >
                  {filter.label}
                </Button>
              ))}
            </div>
            
            <div className="flex gap-2 items-center">
              <div>
                <Label className="text-xs">Дата от</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-36 h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Дата до</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-36 h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Оплата</Label>
                <Input
                  placeholder="Поиск..."
                  value={payFilter}
                  onChange={(e) => setPayFilter(e.target.value)}
                  className="w-28 h-8"
                />
              </div>
            </div>
            
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1">
                <X className="w-3 h-3" />
                Сбросить
              </Button>
            )}
          </div>
        </Card>

        {/* Requests table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 bg-muted animate-shimmer rounded-lg" />
                ))}
              </div>
            ) : filteredRequests.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">ID</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Должность</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Дата</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Оплата</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Кол-во</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Статус</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((request) => (
                      <tr key={request.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-4 px-4 text-sm font-mono">{request.id.slice(0, 8)}</td>
                        <td className="py-4 px-4 font-medium">{request.position}</td>
                        <td className="py-4 px-4 text-sm text-muted-foreground">
                          {format(new Date(request.start_date), 'd MMM', { locale: ru })}
                          {request.start_date !== request.end_date && (
                            <> - {format(new Date(request.end_date), 'd MMM', { locale: ru })}</>
                          )}
                        </td>
                        <td className="py-4 px-4 text-sm">{request.pay || '—'}</td>
                        <td className="py-4 px-4">{request.quantity}</td>
                        <td className="py-4 px-4">{getStatusBadge(request.status)}</td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewDetails(request)}
                              className="gap-1"
                            >
                              <Eye className="w-4 h-4" />
                              Детали
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleContactSupport(request)}
                              className="gap-1"
                            >
                              <MessageCircle className="w-4 h-4" />
                              Поддержка
                            </Button>
                            {request.status === 'pending_confirmation' && (
                              <Button
                                size="sm"
                                onClick={() => handleConfirmCompletion(request.id)}
                                disabled={confirmingId === request.id}
                                className="gap-1 bg-status-success hover:bg-status-success/90"
                              >
                                <ThumbsUp className="w-4 h-4" />
                                Подтвердить
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
                  {hasFilters ? 'Нет заявок по выбранным фильтрам' : 'Заявок пока нет'}
                </p>
                {!hasFilters && (
                  <Link to="/hr/create-request" className="text-primary hover:underline text-sm">
                    Создать первую заявку
                  </Link>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Details Dialog */}
      <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Детали заявки</DialogTitle>
            {selectedRequest?.status === 'pending_confirmation' && (
              <DialogDescription className="text-purple-600">
                Заявка ожидает вашего подтверждения выполнения
              </DialogDescription>
            )}
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Должность</p>
                  <p className="font-medium">{selectedRequest.position}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Статус</p>
                  {getStatusBadge(selectedRequest.status)}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Дата</p>
                  <p className="font-medium">
                    {format(new Date(selectedRequest.start_date), 'd MMMM yyyy', { locale: ru })}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Время</p>
                  <p className="font-medium">
                    {selectedRequest.start_time?.slice(0, 5)} - {selectedRequest.end_time?.slice(0, 5)}
                  </p>
                </div>
                <div className="col-span-2">
                  <p className="text-sm text-muted-foreground">Адрес</p>
                  <p className="font-medium">{selectedRequest.address}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Количество</p>
                  <p className="font-medium">{selectedRequest.quantity} чел.</p>
                </div>
                {selectedRequest.pay && (
                  <div>
                    <p className="text-sm text-muted-foreground">Оплата</p>
                    <p className="font-medium">{selectedRequest.pay}</p>
                  </div>
                )}
              </div>
              
              {selectedRequest.requirements && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Требования</p>
                  <p className="text-sm">{selectedRequest.requirements}</p>
                </div>
              )}

              {/* Assigned Workers */}
              {assignedWorkers.length > 0 && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Назначенные исполнители</p>
                  <div className="space-y-2">
                    {assignedWorkers.map(worker => (
                      <Popover key={worker.id}>
                        <PopoverTrigger asChild>
                          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted transition-colors">
                            <Avatar className="w-8 h-8">
                              <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                                {worker.worker_profile?.full_name?.charAt(0) || 'И'}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <p className="font-medium text-sm">{worker.worker_profile?.full_name || 'Исполнитель'}</p>
                              <p className="text-xs text-muted-foreground">{worker.worker_profile?.phone || '—'}</p>
                            </div>
                            <User className="w-4 h-4 text-muted-foreground" />
                          </div>
                        </PopoverTrigger>
                        <PopoverContent className="w-72">
                          <div className="space-y-2">
                            <h4 className="font-medium">{worker.worker_profile?.full_name || 'Исполнитель'}</h4>
                            <div className="text-sm space-y-1">
                              <p><span className="text-muted-foreground">Телефон:</span> {worker.worker_profile?.phone || '—'}</p>
                              <p><span className="text-muted-foreground">Город:</span> {worker.worker_profile?.city || '—'}</p>
                              <p><span className="text-muted-foreground">Опыт:</span> {worker.worker_profile?.experience || '—'}</p>
                              <p><span className="text-muted-foreground">Рейтинг:</span> {worker.worker_profile?.rating || 0}</p>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    ))}
                  </div>
                </div>
              )}

              {selectedRequest.webhook_sent && selectedRequest.status !== 'pending_confirmation' && (
                <div className="flex items-center gap-2 p-3 bg-status-success/10 rounded-lg">
                  <CheckCircle className="w-4 h-4 text-status-success" />
                  <span className="text-sm text-status-success">Опубликовано в соцсетях</span>
                </div>
              )}

              {selectedRequest.status === 'pending_confirmation' && (
                <div className="pt-4 border-t">
                  <Button
                    onClick={() => handleConfirmCompletion(selectedRequest.id)}
                    disabled={confirmingId === selectedRequest.id}
                    className="w-full gap-2 bg-status-success hover:bg-status-success/90"
                  >
                    <ThumbsUp className="w-4 h-4" />
                    Подтвердить выполнение заявки
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default HRRequests;
