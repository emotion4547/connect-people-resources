import React from 'react';
import { Navigate } from 'react-router-dom';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import PageMeta from '@/components/PageMeta';
import { ROLE_LABELS } from '@/lib/roles';

// Заглушка для ролей, чьи рабочие места ещё не построены: показывает, что вход прошёл
// и учётная запись настроена, а не оставляет человека на странице входа.
const Workspace: React.FC = () => {
  const { role, profile, signOut } = useAuth();
  const { can, loading } = usePermissions();
  // Сотрудникам, у которых уже есть рабочие разделы, сразу открываем первый из них.
  if (loading) return null;
  if (role === 'client_admin' || role === 'client_manager') return <Navigate to="/client/today" replace />;
  // У каждой роли своя стартовая страница: то, с чего начинается рабочий день.
  const HOME: Record<string, string> = { director: '/dashboards', accountant: '/dashboards', sales: '/deals', site_manager: '/planning', recruiter: '/hiring/today' };
  if (role && HOME[role]) return <Navigate to={HOME[role]} replace />;
  if (can('clients', 'view')) return <Navigate to="/clients" replace />;
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <PageMeta title="Рабочее место" description="Рабочее место сотрудника" />
      <div className="flex flex-col items-center gap-4 text-center max-w-md">
        <h1 className="text-2xl font-bold">Здравствуйте{profile?.full_name ? `, ${profile.full_name}` : ''}</h1>
        <p className="text-muted-foreground">
          Ваша роль: {role ? ROLE_LABELS[role] : ''}. Рабочее место для этой роли находится в разработке и появится на следующих этапах.
        </p>
        <Button variant="outline" onClick={() => signOut()}>Выйти</Button>
      </div>
    </div>
  );
};

export default Workspace;
