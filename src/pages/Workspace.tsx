import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import PageMeta from '@/components/PageMeta';
import { ROLE_LABELS } from '@/lib/roles';

// Заглушка для ролей, чьи рабочие места ещё не построены: показывает, что вход прошёл
// и учётная запись настроена, а не оставляет человека на странице входа.
const Workspace: React.FC = () => {
  const { role, profile, signOut } = useAuth();
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
