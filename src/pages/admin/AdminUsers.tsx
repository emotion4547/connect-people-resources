import React, { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layouts/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Users, UserCog, Shield, Briefcase, HardHat } from 'lucide-react';

interface User {
  id: string;
  user_id: string;
  email: string;
  full_name: string | null;
  company: string | null;
  role: 'hr' | 'worker' | 'admin';
  created_at: string;
}

const AdminUsers: React.FC = () => {
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [newRole, setNewRole] = useState<string>('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      // Fetch all user roles
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role, created_at');

      if (rolesError) throw rolesError;

      if (!roles?.length) {
        setLoading(false);
        return;
      }

      const userIds = roles.map(r => r.user_id);

      // Fetch profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, email, full_name, company, id');

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
      <div className="space-y-6 animate-slide-up">
        <div>
          <h1 className="text-3xl font-bold mb-2">Пользователи</h1>
          <p className="text-muted-foreground">
            Управление ролями пользователей
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
            ) : users.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Email</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">ФИО</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Компания</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Роль</th>
                      <th className="text-left py-4 px-4 text-sm font-medium text-muted-foreground">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.user_id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-4 px-4 text-sm">{user.email}</td>
                        <td className="py-4 px-4 font-medium">{user.full_name || '-'}</td>
                        <td className="py-4 px-4 text-sm text-muted-foreground">{user.company || '-'}</td>
                        <td className="py-4 px-4">{getRoleBadge(user.role)}</td>
                        <td className="py-4 px-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenRoleDialog(user)}
                            className="gap-1"
                          >
                            <UserCog className="w-4 h-4" />
                            Изменить роль
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
                <p className="text-muted-foreground">Пользователей пока нет</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Change Role Dialog */}
      <Dialog open={!!selectedUser} onOpenChange={() => setSelectedUser(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Изменить роль пользователя</DialogTitle>
            <DialogDescription>
              {selectedUser?.full_name || selectedUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Новая роль</label>
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
    </DashboardLayout>
  );
};

export default AdminUsers;
