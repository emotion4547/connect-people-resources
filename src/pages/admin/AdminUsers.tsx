import React, { useEffect, useState, useMemo } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Users, UserCog, Shield, Briefcase, HardHat, Search, RotateCcw, Ban, CheckCircle, Trash2 } from 'lucide-react';
import PageMeta from '@/components/PageMeta';

interface User {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  company: string | null;
  role: 'hr' | 'worker' | 'admin';
  created_at: string;
  is_active: boolean;
  block_reason: string | null;
}

const AdminUsers: React.FC = () => {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [newRole, setNewRole] = useState<string>('');
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Filters
  const [searchFilter, setSearchFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role, created_at');

      if (rolesError) throw rolesError;

      if (!roles?.length) {
        setLoading(false);
        return;
      }

      const userIds = roles.map(r => r.user_id);

      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, email, full_name, company, id, is_active, block_reason');

      if (profilesError) throw profilesError;

      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

      const usersData: User[] = roles.map(r => {
        const profile = profileMap.get(r.user_id);
        return {
          id: profile?.id || r.user_id,
          user_id: r.user_id,
          email: profile?.email || '-',
          full_name: profile?.full_name,
          company: profile?.company,
          role: r.role,
          created_at: r.created_at,
          is_active: profile?.is_active ?? true,
          block_reason: profile?.block_reason || null,
        };
      });

      setUsers(usersData);
    } catch (error) {
      console.error('Error fetching users:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось загрузить пользователей',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Filter logic
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      if (searchFilter) {
        const search = searchFilter.toLowerCase();
        const matchName = u.full_name?.toLowerCase().includes(search);
        const matchEmail = u.email?.toLowerCase().includes(search);
        const matchCompany = u.company?.toLowerCase().includes(search);
        if (!matchName && !matchEmail && !matchCompany) return false;
      }
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      return true;
    });
  }, [users, searchFilter, roleFilter]);

  const resetFilters = () => {
    setSearchFilter('');
    setRoleFilter('all');
  };

  const hasActiveFilters = searchFilter || roleFilter !== 'all';

  const handleOpenRoleDialog = (user: User) => {
    setSelectedUser(user);
    setNewRole(user.role);
  };

  const handleChangeRole = async () => {
    if (!selectedUser || !newRole) return;

    try {
      const { error } = await supabase
        .from('user_roles')
        .update({ role: newRole as any })
        .eq('user_id', selectedUser.user_id);

      if (error) throw error;

      setUsers(users.map(u =>
        u.user_id === selectedUser.user_id
          ? { ...u, role: newRole as 'hr' | 'worker' | 'admin' }
          : u
      ));

      toast({
        title: 'Роль изменена',
        description: `Роль пользователя ${selectedUser.full_name || selectedUser.email} изменена на ${getRoleLabel(newRole)}`,
      });

      setSelectedUser(null);
    } catch (error) {
      console.error('Error changing role:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось изменить роль',
        variant: 'destructive',
      });
    }
  };

  const handleOpenBlockDialog = (user: User) => {
    setSelectedUser(user);
    setBlockReason(user.block_reason || '');
    setShowBlockDialog(true);
  };

  const handleBlockUser = async () => {
    if (!selectedUser) return;

    if (!blockReason.trim() && selectedUser.is_active) {
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
          is_active: !selectedUser.is_active,
          block_reason: selectedUser.is_active ? blockReason.trim() : null,
        })
        .eq('user_id', selectedUser.user_id);

      if (error) throw error;

      setUsers(users.map(u =>
        u.user_id === selectedUser.user_id 
          ? { ...u, is_active: !selectedUser.is_active, block_reason: selectedUser.is_active ? blockReason.trim() : null } 
          : u
      ));

      toast({
        title: selectedUser.is_active ? 'Пользователь заблокирован' : 'Пользователь разблокирован',
      });

      setShowBlockDialog(false);
      setBlockReason('');
      setSelectedUser(null);
    } catch (error) {
      console.error('Error toggling user status:', error);
      toast({
        title: 'Ошибка',
        description: 'Не удалось изменить статус',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    setDeleteLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-user', {
        body: { user_id: userToDelete.user_id },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);

      setUsers(prev => prev.filter(u => u.user_id !== userToDelete.user_id));
      toast({
        title: 'Пользователь удалён',
        description: `Аккаунт ${userToDelete.full_name || userToDelete.email} полностью удалён`,
      });
      setShowDeleteDialog(false);
      setUserToDelete(null);
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast({
        title: 'Ошибка удаления',
        description: error.message || 'Не удалось удалить пользователя',
        variant: 'destructive',
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'admin': return 'Администратор';
      case 'hr': return 'HR';
      case 'worker': return 'Исполнитель';
      default: return role;
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return <Badge className="bg-destructive/20 text-destructive gap-1"><Shield className="w-3 h-3" />Админ</Badge>;
      case 'hr':
        return <Badge className="bg-primary/20 text-primary gap-1"><Briefcase className="w-3 h-3" />HR</Badge>;
      case 'worker':
        return <Badge className="bg-secondary/20 text-secondary gap-1"><HardHat className="w-3 h-3" />Исполнитель</Badge>;
      default:
        return <Badge>{role}</Badge>;
    }
  };

  return (
    <DashboardLayout role="admin">
      <PageMeta title="Пользователи" description="Управление пользователями системы" />
      <div className="space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Пользователи</h1>
          <p className="text-muted-foreground">
            Управление ролями и доступом пользователей
          </p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[250px]">
                <label className="text-sm font-medium mb-1 block text-muted-foreground">Поиск</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="ФИО, email, компания"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="w-[180px]">
                <label className="text-sm font-medium mb-1 block text-muted-foreground">Роль</label>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Все роли" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все роли</SelectItem>
                    <SelectItem value="admin">Администратор</SelectItem>
                    <SelectItem value="hr">HR</SelectItem>
                    <SelectItem value="worker">Исполнитель</SelectItem>
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
            ) : filteredUsers.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Email</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">ФИО</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Компания</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Роль</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Статус</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((user) => (
                      <tr key={user.user_id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-4 px-4 text-sm">{user.email}</td>
                        <td className="py-4 px-4 font-medium">{user.full_name || '-'}</td>
                        <td className="py-4 px-4 text-sm text-muted-foreground">{user.company || '-'}</td>
                        <td className="py-4 px-4">{getRoleBadge(user.role)}</td>
                        <td className="py-4 px-4">
                          <Badge className={user.is_active ? 'bg-status-success/20 text-status-success' : 'bg-destructive/20 text-destructive'}>
                            {user.is_active ? 'Активен' : 'Заблокирован'}
                          </Badge>
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenRoleDialog(user)}
                              className="gap-1"
                            >
                              <UserCog className="w-4 h-4" />
                              Роль
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenBlockDialog(user)}
                              className={user.is_active ? "text-destructive hover:text-destructive" : "text-status-success hover:text-status-success"}
                            >
                              {user.is_active ? <Ban className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
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
                <p className="text-muted-foreground">{hasActiveFilters ? 'Нет пользователей по заданным фильтрам' : 'Пользователей пока нет'}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Change Role Dialog */}
      <Dialog open={!!selectedUser && !showBlockDialog} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Изменить роль пользователя</DialogTitle>
            <DialogDescription>
              {selectedUser?.full_name || selectedUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">Новая роль</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите роль" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hr">HR</SelectItem>
                  <SelectItem value="worker">Исполнитель</SelectItem>
                  <SelectItem value="admin">Администратор</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setSelectedUser(null)}>
                Отмена
              </Button>
              <Button onClick={handleChangeRole} disabled={newRole === selectedUser?.role}>
                Сохранить
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Block Dialog */}
      <Dialog open={showBlockDialog} onOpenChange={setShowBlockDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedUser?.is_active ? 'Заблокировать пользователя' : 'Разблокировать пользователя'}
            </DialogTitle>
            <DialogDescription>
              {selectedUser?.full_name || selectedUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {selectedUser?.is_active && (
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
            {!selectedUser?.is_active && selectedUser?.block_reason && (
              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">Текущая причина блокировки:</p>
                <p className="text-sm">{selectedUser.block_reason}</p>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setShowBlockDialog(false); setSelectedUser(null); }}>
                Отмена
              </Button>
              <Button 
                onClick={handleBlockUser}
                variant={selectedUser?.is_active ? "destructive" : "default"}
              >
                {selectedUser?.is_active ? 'Заблокировать' : 'Разблокировать'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
};

export default AdminUsers;