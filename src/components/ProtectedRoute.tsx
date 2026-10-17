import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth, type AppRole } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { MfaGate, MFA_ROLES } from '@/components/MfaGate';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles: AppRole[];
}

export const NoRoleScreen: React.FC = () => {
  const { signOut } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="flex flex-col items-center gap-4 text-center max-w-sm">
        <p className="text-foreground font-medium">Не удалось загрузить профиль</p>
        <p className="text-muted-foreground text-sm">
          Проверьте подключение к интернету и попробуйте ещё раз. Если ошибка повторяется — напишите в поддержку.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>Повторить</Button>
          <Button variant="outline" onClick={() => signOut()}>Выйти</Button>
        </div>
      </div>
    </div>
  );
};

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles }) => {
  const { user, role, loading } = useAuth();

  // Show loading while checking auth state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-muted-foreground">Загрузка...</p>
        </div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Loading has finished but there is no role: a network error or a broken account.
  if (!role) {
    return <NoRoleScreen />;
  }

  // Check if user has required role
  if (!allowedRoles.includes(role)) {
    // Redirect to appropriate dashboard based on actual role
    if (role === 'hr') return <Navigate to="/hr/dashboard" replace />;
    if (role === 'worker') return <Navigate to="/worker/dashboard" replace />;
    if (role === 'admin') return <Navigate to="/admin/dashboard" replace />;
    // Рабочие места остальных ролей сотрудников появляются на следующих шагах.
    return <Navigate to="/workspace" replace />;
  }

  if (MFA_ROLES.includes(role)) return <MfaGate>{children}</MfaGate>;

  return <>{children}</>;
};
