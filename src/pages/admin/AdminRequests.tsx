import React, { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Eye, UserPlus, FileText, AlertCircle } from 'lucide-react';
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
      
      // Fetch HR profiles separately
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

  const handleViewDetails = async (request: Request) => {
    setSelectedRequest(request);
    await fetchResponses(request.id);
  };

  const handleStatusChange = async (requestId: string, newStatus: string) => {
    // Check if trying to set "assigned" without assigned workers
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
      // Check if response already exists
      const existingResponse = responses.find(r => r.worker_id === selectedWorkerToAssign);
      
      if (existingResponse) {
        // Update existing response
        await supabase
          .from('responses')
          .update({ status: 'assigned' as any })
          .eq('id', existingResponse.id);
      } else {
        // Create new response
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
      
      // Refresh responses
      await fetchResponses(selectedRequest.id);
    } catch (error) {
      console.error('Error assigning worker:', error);
      toast({ title: 'Ошибка', variant: 'destructive' });
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
    // Can only set to pending_confirmation if there are assigned workers
    return responses.some(r => r.status === 'assigned');
  };

  return (
    <DashboardLayout role="admin">
      <div className="space-y-6 animate-slide-up">
        <h1 className="text-3xl font-bold">Заявки</h1>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 bg-muted animate-shimmer rounded-lg" />
                ))}
              </div>
            ) : requests.length > 0 ? (
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
                    {requests.map((request) => (
                      <tr key={request.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-4 px-4 text-sm font-mono">{request.id.slice(0, 8)}</td>
                        <td className="py-4 px-4">{request.company || '-'}</td>
                        <td className="py-4 px-4 font-medium">{request.position}</td>
                        <td className="py-4 px-4 text-sm">{format(new Date(request.start_date), 'd MMM', { locale: ru })}</td>
                        <td className="py-4 px-4">{getStatusBadge(request.status)}</td>
                        <td className="py-4 px-4">
                          <Button variant="ghost" size="sm" onClick={() => handleViewDetails(request)}>
                            <Eye className="w-4 h-4 mr-1" /> Детали
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground">Заявок пока нет</p>
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

      {/* Assign Worker Dialog */}
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
