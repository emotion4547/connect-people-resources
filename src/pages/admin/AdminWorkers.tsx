import React, { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Eye, Users, UserPlus } from 'lucide-react';

interface Worker {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  city: string | null;
  experience: string | null;
  preferred_schedule: string | null;
  preferred_positions: string[] | null;
  is_active: boolean;
  rating: number;
}

const AdminWorkers: React.FC = () => {
  const { toast } = useToast();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [newWorker, setNewWorker] = useState({
    email: '',
    password: '',
    fullName: '',
    phone: '',
    city: '',
  });

  useEffect(() => {
    fetchWorkers();
  }, []);

  const fetchWorkers = async () => {
    try {
      // Get worker user_ids from user_roles
      const { data: roles } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'worker');

      if (!roles?.length) {
        setLoading(false);
        return;
      }

      const workerIds = roles.map(r => r.user_id);

      // Get profiles for these users
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

  const handleToggleActive = async (worker: Worker) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: !worker.is_active })
        .eq('id', worker.id);

      if (error) throw error;

      setWorkers(workers.map(w =>
        w.id === worker.id ? { ...w, is_active: !w.is_active } : w
      ));

      if (selectedWorker?.id === worker.id) {
        setSelectedWorker({ ...selectedWorker, is_active: !selectedWorker.is_active });
      }

      toast({
        title: worker.is_active ? 'Исполнитель заблокирован' : 'Исполнитель активирован',
        description: `Статус ${worker.full_name || 'исполнителя'} изменен`,
      });
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
      // Create user via signup
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
        // Update profile with additional data
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
      
      // Refresh list
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

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 bg-muted animate-shimmer rounded-lg" />
                ))}
              </div>
            ) : workers.length > 0 ? (
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
                    {workers.map((worker) => (
                      <tr key={worker.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-4 px-4 font-medium">{worker.full_name || '-'}</td>
                        <td className="py-4 px-4 text-sm text-muted-foreground">{worker.city || '-'}</td>
                        <td className="py-4 px-4 text-sm">{worker.phone || '-'}</td>
                        <td className="py-4 px-4">
                          <span className="text-secondary font-medium">{(worker.rating || 0).toFixed(1)}</span>
                        </td>
                        <td className="py-4 px-4">
                          <Badge className={worker.is_active ? 'bg-status-success/20 text-status-success' : 'bg-status-gray/20 text-muted-foreground'}>
                            {worker.is_active ? 'Активен' : 'Заблокирован'}
                          </Badge>
                        </td>
                        <td className="py-4 px-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedWorker(worker)}
                            className="gap-1"
                          >
                            <Eye className="w-4 h-4" />
                            Детали
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-12">
                <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground mb-4">Исполнителей пока нет</p>
                <Button onClick={() => setShowAddDialog(true)} variant="outline" className="gap-2">
                  <UserPlus className="w-4 h-4" />
                  Добавить первого
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Details Dialog */}
      <Dialog open={!!selectedWorker} onOpenChange={() => setSelectedWorker(null)}>
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

              <div className="flex items-center justify-between pt-4 border-t">
                <div>
                  <p className="font-medium">Статус активности</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedWorker.is_active ? 'Исполнитель может принимать заказы' : 'Исполнитель заблокирован'}
                  </p>
                </div>
                <Switch
                  checked={selectedWorker.is_active}
                  onCheckedChange={() => handleToggleActive(selectedWorker)}
                />
              </div>
            </div>
          )}
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
