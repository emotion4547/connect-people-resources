import React, { useEffect, useState, useMemo } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Eye, UserPlus, FileText, AlertCircle, Search, RotateCcw, Calendar, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface Request {
  id: string;
  position: string;
  start_date: string;
  end_date: string;
  address: string;
  quantity: number;
  status: string;
  pay: string | null;
  requirements: string | null;
  webhook_sent: boolean;
  hr_id: string;
  company?: string;
}

interface Response {
  id: string;
  status: string;
  worker_id: string;
  full_name?: string;
  phone?: string;
  city?: string;
}

interface Worker {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  is_active: boolean;
}

const AdminRequests: React.FC = () => {
  const { toast } = useToast();
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);
  const [responses, setResponses] = useState<Response[]>([]);
  const [loadingResponses, setLoadingResponses] = useState(false);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedWorkerToAssign, setSelectedWorkerToAssign] = useState<string>('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [companyFilter, setCompanyFilter] = useState<string>('');
  const [dateFilter, setDateFilter] = useState<string>('');

  useEffect(() => {
    fetchRequests();
    fetchAllWorkers();
  }, []);

  const fetchRequests = async () => {
    try {
      const { data, error } = await supabase
        .from('requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      const hrIds = [...new Set((data || []).map(r => r.hr_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, company')
        .in('user_id', hrIds);
      
      const profileMap = new Map(profiles?.map(p => [p.user_id, p.company]) || []);
      
      setRequests((data || []).map(r => ({
        ...r,
        company: profileMap.get(r.hr_id) || undefined,
      })));
    } catch (error) {
      console.error('Error fetching requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllWorkers = async () => {
    try {
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'worker');

      if (!roles?.length) return;

      const workerIds = roles.map(r => r.user_id);

      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, phone, city, is_active')
        .in('user_id', workerIds);

      setWorkers((profiles || []).filter(w => w.is_active));
    } catch (error) {
      console.error('Error fetching workers:', error);
    }
  };

  const fetchResponses = async (requestId: string) => {
    setLoadingResponses(true);
    try {
      const { data, error } = await supabase
        .from('responses')
        .select('*')
        .eq('request_id', requestId);

      if (error) throw error;
      
      const workerIds = (data || []).map(r => r.worker_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, phone, city')
        .in('user_id', workerIds);
      
      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
      
      setResponses((data || []).map(r => ({
        ...r,
        ...profileMap.get(r.worker_id),
      })));
    } catch (error) {
      console.error('Error fetching responses:', error);
    } finally {
      setLoadingResponses(false);
    }
  };

  // Filter logic
  const filteredRequests = useMemo(() => {
    return requests.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (companyFilter && !r.company?.toLowerCase().includes(companyFilter.toLowerCase())) return false;
      if (dateFilter && r.start_date !== dateFilter) return false;
      return true;
    });
  }, [requests, statusFilter, companyFilter, dateFilter]);

  const resetFilters = () => {
    setStatusFilter('all');
    setCompanyFilter('');
    setDateFilter('');
  };

  const hasActiveFilters = statusFilter !== 'all' || companyFilter || dateFilter;

  const handleViewDetails = async (request: Request) => {
    setSelectedRequest(request);
    await fetchResponses(request.id);
  };

  const handleStatusChange = async (requestId: string, newStatus: string) => {
    if (newStatus === 'assigned') {
      const hasAssignedWorker = responses.some(r => r.status === 'assigned');
      if (!hasAssignedWorker) {
        toast({
          title: 'Невозможно изменить статус',
          description: 'Сначала назначьте исполнителя на заявку',
          variant: 'destructive',
        });
        return;
      }
    }

    try {
      const { error } = await supabase
        .from('requests')
        .update({ status: newStatus as any })
        .eq('id', requestId);

      if (error) throw error;

      setRequests(requests.map(r => 
        r.id === requestId ? { ...r, status: newStatus } : r
      ));

      if (selectedRequest?.id === requestId) {
        setSelectedRequest({ ...selectedRequest, status: newStatus });
      }

      toast({ title: 'Статус обновлен' });
    } catch (error) {
      console.error('Error updating status:', error);
      toast({ title: 'Ошибка', variant: 'destructive' });
    }
  };

  const handleAssignWorkerFromResponse = async (responseId: string) => {
    try {
      const { error } = await supabase
        .from('responses')
        .update({ status: 'assigned' as any })
        .eq('id', responseId);

      if (error) throw error;

      setResponses(responses.map(r =>
        r.id === responseId ? { ...r, status: 'assigned' } : r
      ));

      toast({ title: 'Исполнитель назначен' });
    } catch (error) {
      console.error('Error assigning worker:', error);
      toast({ title: 'Ошибка', variant: 'destructive' });
    }
  };

  const handleAssignWorkerDirectly = async () => {
    if (!selectedRequest || !selectedWorkerToAssign) return;

    try {
      const existingResponse = responses.find(r => r.worker_id === selectedWorkerToAssign);
      
      if (existingResponse) {
        await supabase
          .from('responses')
          .update({ status: 'assigned' as any })
          .eq('id', existingResponse.id);
      } else {
        await supabase
          .from('responses')
          .insert({
            request_id: selectedRequest.id,
            worker_id: selectedWorkerToAssign,
            status: 'assigned',
          });
      }

      toast({ title: 'Исполнитель назначен' });
      setShowAssignDialog(false);
      setSelectedWorkerToAssign('');
      
      await fetchResponses(selectedRequest.id);
    } catch (error) {
      console.error('Error assigning worker:', error);
      toast({ title: 'Ошибка', variant: 'destructive' });
    }
  };

  const handleDeleteRequest = async (requestId: string) => {
    setDeletingId(requestId);
    try {
      // First delete related responses
      await supabase.from('responses').delete().eq('request_id', requestId);
      
      // Then delete the request
      const { error } = await supabase.from('requests').delete().eq('id', requestId);

      if (error) throw error;

      setRequests(requests.filter(r => r.id !== requestId));
      
      if (selectedRequest?.id === requestId) {
        setSelectedRequest(null);
      }

      toast({ title: 'Заявка удалена' });
    } catch (error) {
      console.error('Error deleting request:', error);
      toast({ title: 'Ошибка удаления', variant: 'destructive' });
    } finally {
      setDeletingId(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; className: string }> = {
      new: { label: 'Новая', className: 'bg-status-orange/20 text-status-orange' },
      in_progress: { label: 'В работе', className: 'bg-primary/20 text-primary' },
      assigned: { label: 'Назначено', className: 'bg-status-gold/20 text-secondary' },
      pending_confirmation: { label: 'Ожидает подтверждения', className: 'bg-purple-500/20 text-purple-600' },
      completed: { label: 'Выполнено', className: 'bg-status-success/20 text-status-success' },
      cancelled: { label: 'Отменена', className: 'bg-status-gray/20 text-muted-foreground' },
      pending: { label: 'Ожидает', className: 'bg-status-orange/20 text-status-orange' },
      rejected: { label: 'Отклонен', className: 'bg-destructive/20 text-destructive' },
    };
    const variant = variants[status] || variants.new;
    return <Badge className={variant.className}>{variant.label}</Badge>;
  };

  const canSetCompleted = () => {
    return responses.some(r => r.status === 'assigned');
  };

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6 animate-slide-up">
        <h1 className="text-3xl font-bold">Заявки</h1>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium mb-1 block text-muted-foreground">Статус</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Все статусы" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все статусы</SelectItem>
                    <SelectItem value="new">Новая</SelectItem>
                    <SelectItem value="in_progress">В работе</SelectItem>
                    <SelectItem value="assigned">Назначено</SelectItem>
                    <SelectItem value="pending_confirmation">Ожидает подтверждения</SelectItem>
                    <SelectItem value="completed">Выполнено</SelectItem>
                    <SelectItem value="cancelled">Отменена</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium mb-1 block text-muted-foreground">Компания</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Поиск по компании"
                    value={companyFilter}
                    onChange={(e) => setCompanyFilter(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium mb-1 block text-muted-foreground">Дата начала</label>
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
            ) : filteredRequests.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">ID</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Компания</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Должность</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Дата</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Статус</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((request) => (
                      <tr key={request.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-4 px-4 text-sm font-mono">{request.id.slice(0, 8)}</td>
                        <td className="py-4 px-4">{request.company || '-'}</td>
                        <td className="py-4 px-4 font-medium">{request.position}</td>
                        <td className="py-4 px-4 text-sm">{format(new Date(request.start_date), 'd MMM', { locale: ru })}</td>
                        <td className="py-4 px-4">{getStatusBadge(request.status)}</td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => handleViewDetails(request)}>
                              <Eye className="w-4 h-4 mr-1" /> Детали
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  disabled={deletingId === request.id}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Удалить заявку?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Это действие нельзя отменить. Заявка и все связанные отклики будут удалены.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteRequest(request.id)}
                                    className="bg-destructive hover:bg-destructive/90"
                                  >
                                    Удалить
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
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
                <p className="text-muted-foreground">{hasActiveFilters ? 'Нет заявок по заданным фильтрам' : 'Заявок пока нет'}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!selectedRequest} onOpenChange={() => setSelectedRequest(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Детали заявки</DialogTitle>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-sm text-muted-foreground">Должность</p><p className="font-medium">{selectedRequest.position}</p></div>
                <div><p className="text-sm text-muted-foreground">Адрес</p><p className="font-medium">{selectedRequest.address}</p></div>
              </div>
              
              <div>
                <p className="text-sm text-muted-foreground mb-2">Изменить статус</p>
                <Select value={selectedRequest.status} onValueChange={(v) => handleStatusChange(selectedRequest.id, v)}>
                  <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Новая</SelectItem>
                    <SelectItem value="in_progress">В работе</SelectItem>
                    <SelectItem value="assigned" disabled={!responses.some(r => r.status === 'assigned')}>
                      Назначено
                    </SelectItem>
                    <SelectItem value="pending_confirmation" disabled={!canSetCompleted()}>
                      Выполнено (ожидает подтверждения HR)
                    </SelectItem>
                  </SelectContent>
                </Select>
                {selectedRequest.status !== 'assigned' && !responses.some(r => r.status === 'assigned') && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Для статуса "Назначено" нужно назначить исполнителя
                  </p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium">Отклики и назначения</p>
                  <Button size="sm" variant="outline" onClick={() => setShowAssignDialog(true)} className="gap-1">
                    <UserPlus className="w-4 h-4" />
                    Назначить из списка
                  </Button>
                </div>
                {loadingResponses ? (
                  <div className="h-20 bg-muted animate-shimmer rounded-lg" />
                ) : responses.length > 0 ? (
                  <div className="space-y-2">
                    {responses.map((r) => (
                      <div key={r.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                        <div>
                          <p className="font-medium">{r.full_name || 'Без имени'}</p>
                          <p className="text-sm text-muted-foreground">{r.city} • {r.phone}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(r.status)}
                          {r.status === 'pending' && (
                            <Button size="sm" onClick={() => handleAssignWorkerFromResponse(r.id)}>
                              <UserPlus className="w-4 h-4 mr-1" />Назначить
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Откликов нет. Вы можете назначить исполнителя из списка.</p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Назначить исполнителя</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Select value={selectedWorkerToAssign} onValueChange={setSelectedWorkerToAssign}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите исполнителя" />
              </SelectTrigger>
              <SelectContent>
                {workers.map((worker) => (
                  <SelectItem key={worker.user_id} value={worker.user_id}>
                    {worker.full_name || 'Без имени'} {worker.city ? `(${worker.city})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowAssignDialog(false)}>
                Отмена
              </Button>
              <Button onClick={handleAssignWorkerDirectly} disabled={!selectedWorkerToAssign}>
                Назначить
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminRequests;