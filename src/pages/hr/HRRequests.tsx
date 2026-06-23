import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { PlusCircle, Eye, CheckCircle, FileText, ThumbsUp, Filter, X, MessageCircle, User, Star, Copy, Ban } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import PageMeta from '@/components/PageMeta';
import { WorkerRating } from '@/components/WorkerRating';

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
  site_id: string | null;
}

interface Site {
  id: string;
  name: string;
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
  
  // Rating state
  const [showRatingDialog, setShowRatingDialog] = useState(false);
  const [workersToRate, setWorkersToRate] = useState<Response[]>([]);
  const [currentRatingIndex, setCurrentRatingIndex] = useState(0);
  
  // Additional filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [payFilter, setPayFilter] = useState('');
  const [siteFilter, setSiteFilter] = useState<string>('all');
  const [sites, setSites] = useState<Site[]>([]);

  useEffect(() => {
    fetchRequests();
    void fetchMySites();
  }, [user]);

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

  const fetchMySites = async () => {
    if (!user) return;
    const { data: assignments } = await supabase
      .from('site_managers')
      .select('site_id')
      .eq('hr_user_id', user.id);
    const ids = (assignments || []).map((a) => a.site_id);
    if (ids.length === 0) {
      setSites([]);
      return;
    }
    const { data } = await supabase
      .from('sites')
      .select('id, name')
      .in('id', ids)
      .order('name');
    setSites(data || []);
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
      // 1. Update request status -> completed, verify the row actually changed
      const { data: updated, error: updateErr } = await supabase
        .from('requests')
        .update({ status: 'completed' as any })
        .eq('id', requestId)
        .select('id, status');

      if (updateErr) throw new Error(`Не удалось обновить заявку: ${updateErr.message}`);
      if (!updated || updated.length === 0) {
        throw new Error('Заявка не обновлена — недостаточно прав или заявка не найдена.');
      }

      // 2. Mark assigned responses as completed (non-blocking; rating still works without it)
      const { error: respErr } = await supabase
        .from('responses')
        .update({ status: 'completed' as any })
        .eq('request_id', requestId)
        .eq('status', 'assigned');
      if (respErr) console.warn('responses update warning:', respErr.message);

      setRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: 'completed' } : r)));
      if (selectedRequest?.id === requestId) {
        setSelectedRequest({ ...selectedRequest, status: 'completed' });
      }

      toast({ title: 'Заявка подтверждена', description: 'Заявка отмечена как выполненная' });

      // 3. Fetch workers to rate (include both completed and assigned in case the responses update was blocked)
      const { data: assignedForRating } = await supabase
        .from('responses')
        .select('id, worker_id, status')
        .eq('request_id', requestId)
        .in('status', ['completed', 'assigned']);

      if (assignedForRating && assignedForRating.length > 0) {
        const workerIds = assignedForRating.map((r) => r.worker_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, full_name, phone, city, experience, rating')
          .in('user_id', workerIds);

        const workersWithProfiles = assignedForRating.map((resp) => ({
          ...resp,
          worker_profile: profiles?.find((p) => p.user_id === resp.worker_id),
        }));

        setWorkersToRate(workersWithProfiles);
        setCurrentRatingIndex(0);
        setShowRatingDialog(true);
      }
    } catch (error: any) {
      console.error('Error confirming request:', error);
      toast({
        title: 'Ошибка',
        description: error?.message || 'Не удалось подтвердить выполнение',
        variant: 'destructive',
      });
    } finally {
      setConfirmingId(null);
    }
  };

  const handleRateWorker = async (rating: number, comment: string) => {
    const worker = workersToRate[currentRatingIndex];
    if (!worker) return;

    try {
      // Get current profile to calculate new average rating
      const { data: profile } = await supabase
        .from('profiles')
        .select('rating')
        .eq('user_id', worker.worker_id)
        .maybeSingle();

      // Calculate new rating (simple average for now, can be improved)
      const currentRating = profile?.rating || 0;
      const newRating = currentRating === 0 ? rating : (currentRating + rating) / 2;

      await supabase
        .from('profiles')
        .update({ rating: Math.round(newRating * 10) / 10 })
        .eq('user_id', worker.worker_id);

      toast({
        title: 'Оценка сохранена',
        description: `Рейтинг ${worker.worker_profile?.full_name || 'исполнителя'} обновлён`,
      });

      // Move to next worker or close dialog
      if (currentRatingIndex < workersToRate.length - 1) {
        setCurrentRatingIndex(currentRatingIndex + 1);
      } else {
        setShowRatingDialog(false);
        setWorkersToRate([]);
        setCurrentRatingIndex(0);
      }
    } catch (error) {
      console.error('Error rating worker:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось сохранить оценку',
        variant: 'destructive',
      });
    }
  };

  const handleSkipRating = () => {
    if (currentRatingIndex < workersToRate.length - 1) {
      setCurrentRatingIndex(currentRatingIndex + 1);
    } else {
      setShowRatingDialog(false);
      setWorkersToRate([]);
      setCurrentRatingIndex(0);
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

  const hasFilters = activeFilter !== 'all' || dateFrom || dateTo || payFilter || siteFilter !== 'all';

  const clearFilters = () => {
    setActiveFilter('all');
    setDateFrom('');
    setDateTo('');
    setPayFilter('');
    setSiteFilter('all');
  };

  const filteredRequests = requests.filter(r => {
    if (activeFilter !== 'all' && r.status !== activeFilter) return false;
    if (siteFilter !== 'all' && r.site_id !== siteFilter) return false;
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
      <PageMeta title="Мои заявки" description="Список заявок на персонал" />
      <div className="space-y-6 animate-slide-up">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <h1 className="text-2xl sm:text-3xl font-bold">Мои заявки</h1>
          <Link to="/hr/create-request" className="w-full sm:w-auto">
            <Button className="btn-hover gap-2 w-full sm:w-auto">
              <PlusCircle className="w-4 h-4" />
              Создать заявку
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <Card className="p-4">
          <div className="space-y-4">
            {/* Status filters - scrollable on mobile */}
            <div className="overflow-x-auto pb-2 -mx-4 px-4">
              <div className="flex gap-2 min-w-max">
                {statusFilters.map((filter) => (
                  <Button
                    key={filter.id}
                    variant={activeFilter === filter.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveFilter(filter.id)}
                    className="rounded-full text-xs sm:text-sm whitespace-nowrap"
                  >
                    {filter.label}
                  </Button>
                ))}
              </div>
            </div>
            
            {/* Site + Date filters */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 items-end">
              {sites.length > 1 && (
                <div>
                  <Label className="text-xs">Объект</Label>
                  <Select value={siteFilter} onValueChange={setSiteFilter}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все объекты</SelectItem>
                      {sites.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label className="text-xs">Дата от</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Дата до</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 h-9">
                  <X className="w-3 h-3" />
                  Сбросить
                </Button>
              )}
            </div>
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
                              <p className="flex items-center gap-1">
                                <span className="text-muted-foreground">Рейтинг:</span>
                                <span className="flex items-center">
                                  {[1, 2, 3, 4, 5].map(star => (
                                    <Star
                                      key={star}
                                      className={`w-3 h-3 ${
                                        star <= Math.round(worker.worker_profile?.rating || 0)
                                          ? 'fill-secondary text-secondary'
                                          : 'text-muted-foreground/30'
                                      }`}
                                    />
                                  ))}
                                  <span className="ml-1 text-xs">({(worker.worker_profile?.rating || 0).toFixed(1)})</span>
                                </span>
                              </p>
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

      {/* Rating Dialog */}
      <Dialog open={showRatingDialog} onOpenChange={setShowRatingDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Оценка исполнителя</DialogTitle>
            <DialogDescription>
              {workersToRate.length > 1 && (
                <span>{currentRatingIndex + 1} из {workersToRate.length}</span>
              )}
            </DialogDescription>
          </DialogHeader>
          {workersToRate[currentRatingIndex] && (
            <WorkerRating
              workerName={workersToRate[currentRatingIndex].worker_profile?.full_name || 'Исполнитель'}
              currentRating={workersToRate[currentRatingIndex].worker_profile?.rating || 0}
              onSubmit={handleRateWorker}
              onSkip={handleSkipRating}
            />
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default HRRequests;
