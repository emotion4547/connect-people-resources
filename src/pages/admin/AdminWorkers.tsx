import React, { useEffect, useState, useMemo } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Eye, Users, UserPlus, Search, RotateCcw, Ban, CheckCircle, Trash2 } from 'lucide-react';
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
import PageMeta from '@/components/PageMeta';

interface Worker {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string;
  login: string | null;
  phone: string | null;
  city: string | null;
  experience: string | null;
  preferred_schedule: string | null;
  preferred_positions: string[] | null;
  is_active: boolean;
  rating: number;
  block_reason: string | null;
}

const WORKER_EMAIL_DOMAIN = 'workers.local';
const loginRegex = /^[a-zA-Z0-9._-]{3,32}$/;

const AdminWorkers: React.FC = () => {
  const { toast } = useToast();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [workerToDelete, setWorkerToDelete] = useState<Worker | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [addLoading, setAddLoading] = useState(false);
  const [newWorker, setNewWorker] = useState({
    login: '',
    password: '',
    fullName: '',
    phone: '',
    city: '',
  });

  // Filters
  const [searchFilter, setSearchFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    fetchWorkers();
  }, []);

  const fetchWorkers = async () => {
    try {
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'worker');

      if (!roles?.length) {
        setLoading(false);
        return;
      }

      const workerIds = roles.map(r => r.user_id);

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('user_id', workerIds);

      if (error) throw error;
      setWorkers(data || []);
    } catch (error) {
      console.error('Error fetching workers:', error);
    } finally {
      setLoading(false);
    }
  };

  // Unique cities for filter
  const uniqueCities = useMemo(() => {
    const cities = workers.map(w => w.city).filter(Boolean) as string[];
    return [...new Set(cities)].sort();
  }, [workers]);

  // Filter logic
  const filteredWorkers = useMemo(() => {
    return workers.filter(w => {
      if (searchFilter) {
        const search = searchFilter.toLowerCase();
        const matchName = w.full_name?.toLowerCase().includes(search);
        const matchPhone = w.phone?.includes(search);
        const matchEmail = w.email?.toLowerCase().includes(search);
        if (!matchName && !matchPhone && !matchEmail) return false;
      }
      if (cityFilter && w.city !== cityFilter) return false;
      if (statusFilter === 'active' && !w.is_active) return false;
      if (statusFilter === 'blocked' && w.is_active) return false;
      return true;
    });
  }, [workers, searchFilter, cityFilter, statusFilter]);

  const resetFilters = () => {
    setSearchFilter('');
    setCityFilter('');
    setStatusFilter('all');
  };

  const hasActiveFilters = searchFilter || cityFilter || statusFilter !== 'all';

  const handleOpenBlockDialog = (worker: Worker) => {
    setSelectedWorker(worker);
    setBlockReason(worker.block_reason || '');
    setShowBlockDialog(true);
  };

  const handleBlockWorker = async () => {
    if (!selectedWorker) return;

    if (!blockReason.trim() && selectedWorker.is_active) {
      toast({
        title: 'Укажите причину',
        description: 'Для блокировки необходимо указать причину',
        variant: 'destructive',
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ 
          is_active: !selectedWorker.is_active,
          block_reason: selectedWorker.is_active ? blockReason.trim() : null,
        })
        .eq('id', selectedWorker.id);

      if (error) throw error;

      setWorkers(workers.map(w =>
        w.id === selectedWorker.id 
          ? { ...w, is_active: !selectedWorker.is_active, block_reason: selectedWorker.is_active ? blockReason.trim() : null } 
          : w
      ));

      toast({
        title: selectedWorker.is_active ? 'Исполнитель заблокирован' : 'Исполнитель разблокирован',
        description: `Статус ${selectedWorker.full_name || 'исполнителя'} изменен`,
      });

      setShowBlockDialog(false);
      setBlockReason('');
    } catch (error) {
      console.error('Error toggling worker status:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось изменить статус',
        variant: 'destructive',
      });
    }
  };

  const handleAddWorker = async () => {
    if (!newWorker.email || !newWorker.password || !newWorker.fullName) {
      toast({
        title: 'Ошибка',
        description: 'Заполните обязательные поля',
        variant: 'destructive',
      });
      return;
    }

    setAddLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: newWorker.email,
        password: newWorker.password,
        options: {
          data: {
            role: 'worker',
            full_name: newWorker.fullName,
          },
          emailRedirectTo: `${window.location.origin}/`,
        },
      });

      if (error) throw error;

      if (data.user) {
        await supabase
          .from('profiles')
          .update({
            phone: newWorker.phone || null,
            city: newWorker.city || null,
          })
          .eq('user_id', data.user.id);
      }

      toast({
        title: 'Исполнитель добавлен',
        description: 'Аккаунт успешно создан',
      });

      setShowAddDialog(false);
      setNewWorker({ email: '', password: '', fullName: '', phone: '', city: '' });
      
      setTimeout(fetchWorkers, 1000);
    } catch (error: any) {
      console.error('Error adding worker:', error);
      toast({
        title: 'Ошибка',
        description: error.message || 'Не удалось добавить исполнителя',
        variant: 'destructive',
      });
    } finally {
      setAddLoading(false);
    }
  };

  return (
    <DashboardLayout role="admin">
      <PageMeta title="Исполнители" description="Управление исполнителями" />
      <div className="space-y-6 animate-slide-up">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">Исполнители</h1>
            <p className="text-muted-foreground">
              Управление базой исполнителей
            </p>
          </div>
          <Button onClick={() => setShowAddDialog(true)} className="gap-2">
            <UserPlus className="w-4 h-4" />
            Добавить исполнителя
          </Button>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium mb-1 block text-muted-foreground">Поиск</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="ФИО, телефон, email"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="w-[180px]">
                <label className="text-sm font-medium mb-1 block text-muted-foreground">Город</label>
                <Select value={cityFilter || "all"} onValueChange={(val) => setCityFilter(val === "all" ? "" : val)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Все города" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все города</SelectItem>
                    {uniqueCities.map(city => (
                      <SelectItem key={city} value={city}>{city}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-[180px]">
                <label className="text-sm font-medium mb-1 block text-muted-foreground">Статус</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Все" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все</SelectItem>
                    <SelectItem value="active">Активные</SelectItem>
                    <SelectItem value="blocked">Заблокированные</SelectItem>
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
            ) : filteredWorkers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">ФИО</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Город</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Телефон</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Рейтинг</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Статус</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWorkers.map((worker) => (
                      <tr key={worker.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-4 px-4 font-medium">{worker.full_name || '-'}</td>
                        <td className="py-4 px-4 text-sm text-muted-foreground">{worker.city || '-'}</td>
                        <td className="py-4 px-4 text-sm">{worker.phone || '-'}</td>
                        <td className="py-4 px-4">
                          <span className="text-secondary font-medium">{(worker.rating || 0).toFixed(1)}</span>
                        </td>
                        <td className="py-4 px-4">
                          <Badge className={worker.is_active ? 'bg-status-success/20 text-status-success' : 'bg-destructive/20 text-destructive'}>
                            {worker.is_active ? 'Активен' : 'Заблокирован'}
                          </Badge>
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedWorker(worker)}
                              className="gap-1"
                            >
                              <Eye className="w-4 h-4" />
                              Детали
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenBlockDialog(worker)}
                              className={worker.is_active ? "text-destructive hover:text-destructive" : "text-status-success hover:text-status-success"}
                            >
                              {worker.is_active ? <Ban className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12">
                <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground mb-4">{hasActiveFilters ? 'Нет исполнителей по заданным фильтрам' : 'Исполнителей пока нет'}</p>
                {!hasActiveFilters && (
                  <Button onClick={() => setShowAddDialog(true)} variant="outline" className="gap-2">
                    <UserPlus className="w-4 h-4" />
                    Добавить первого
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Details Dialog */}
      <Dialog open={!!selectedWorker && !showBlockDialog} onOpenChange={() => setSelectedWorker(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Карточка исполнителя</DialogTitle>
          </DialogHeader>
          {selectedWorker && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">ФИО</p>
                  <p className="font-medium">{selectedWorker.full_name || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium">{selectedWorker.email}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Телефон</p>
                  <p className="font-medium">{selectedWorker.phone || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Город</p>
                  <p className="font-medium">{selectedWorker.city || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Рейтинг</p>
                  <p className="font-medium text-secondary">{(selectedWorker.rating || 0).toFixed(1)} / 5.0</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">График</p>
                  <p className="font-medium">{selectedWorker.preferred_schedule || '-'}</p>
                </div>
              </div>

              {selectedWorker.experience && (
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Опыт работы</p>
                  <p className="text-sm">{selectedWorker.experience}</p>
                </div>
              )}

              {selectedWorker.preferred_positions?.length && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Предпочитаемые должности</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedWorker.preferred_positions.map((pos, i) => (
                      <Badge key={i} variant="secondary">{pos}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {!selectedWorker.is_active && selectedWorker.block_reason && (
                <div className="p-3 bg-destructive/10 rounded-lg">
                  <p className="text-sm font-medium text-destructive mb-1">Причина блокировки:</p>
                  <p className="text-sm">{selectedWorker.block_reason}</p>
                </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t">
                <Badge className={selectedWorker.is_active ? 'bg-status-success/20 text-status-success' : 'bg-destructive/20 text-destructive'}>
                  {selectedWorker.is_active ? 'Активен' : 'Заблокирован'}
                </Badge>
                <Button 
                  variant={selectedWorker.is_active ? "destructive" : "default"}
                  onClick={() => handleOpenBlockDialog(selectedWorker)}
                  className="gap-2"
                >
                  {selectedWorker.is_active ? <Ban className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
                  {selectedWorker.is_active ? 'Заблокировать' : 'Разблокировать'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Block Dialog */}
      <Dialog open={showBlockDialog} onOpenChange={setShowBlockDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedWorker?.is_active ? 'Заблокировать исполнителя' : 'Разблокировать исполнителя'}
            </DialogTitle>
            <DialogDescription>
              {selectedWorker?.full_name || selectedWorker?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {selectedWorker?.is_active && (
              <div>
                <Label htmlFor="blockReason">Причина блокировки *</Label>
                <Textarea
                  id="blockReason"
                  placeholder="Укажите причину блокировки..."
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Эта причина будет показана пользователю при попытке входа
                </p>
              </div>
            )}
            {!selectedWorker?.is_active && selectedWorker?.block_reason && (
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">Текущая причина блокировки:</p>
                <p className="text-sm">{selectedWorker.block_reason}</p>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowBlockDialog(false)}>
                Отмена
              </Button>
              <Button 
                onClick={handleBlockWorker}
                variant={selectedWorker?.is_active ? "destructive" : "default"}
              >
                {selectedWorker?.is_active ? 'Заблокировать' : 'Разблокировать'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Worker Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить исполнителя</DialogTitle>
            <DialogDescription>
              Создание нового аккаунта исполнителя
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="workerEmail">Email *</Label>
              <Input
                id="workerEmail"
                type="email"
                placeholder="email@example.com"
                value={newWorker.email}
                onChange={(e) => setNewWorker({ ...newWorker, email: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="workerPassword">Пароль *</Label>
              <Input
                id="workerPassword"
                type="password"
                placeholder="Минимум 6 символов"
                value={newWorker.password}
                onChange={(e) => setNewWorker({ ...newWorker, password: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="workerName">ФИО *</Label>
              <Input
                id="workerName"
                placeholder="Иванов Иван Иванович"
                value={newWorker.fullName}
                onChange={(e) => setNewWorker({ ...newWorker, fullName: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="workerPhone">Телефон</Label>
              <Input
                id="workerPhone"
                placeholder="+7 (999) 123-45-67"
                value={newWorker.phone}
                onChange={(e) => setNewWorker({ ...newWorker, phone: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="workerCity">Город</Label>
              <Input
                id="workerCity"
                placeholder="Москва"
                value={newWorker.city}
                onChange={(e) => setNewWorker({ ...newWorker, city: e.target.value })}
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                Отмена
              </Button>
              <Button onClick={handleAddWorker} disabled={addLoading}>
                {addLoading ? 'Создание...' : 'Создать'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminWorkers;