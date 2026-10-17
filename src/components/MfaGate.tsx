import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/contexts/OrgContext';
import { rpc } from '@/lib/db';

// Роли с доступом к финансам и паспортным данным (ТЗ, А-6).
export const MFA_ROLES = ['director', 'accountant', 'recruiter', 'admin'];

// Пускает в рабочие разделы, только если двухфакторный вход подтверждён в этой сессии
// (когда организация включила обязательность). Это проверка интерфейса: защита самих данных
// по уровню подтверждения (aal2) добавляется в политики таблиц с деньгами и паспортными данными
// на шагах 8–10.
export const MfaGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { orgId, loading: orgLoading } = useOrg();
  const [state, setState] = useState<'checking' | 'ok' | 'needs-mfa'>('checking');

  useEffect(() => {
    if (orgLoading) return;
    if (!orgId) { setState('ok'); return; }
    let cancelled = false;
    (async () => {
      const { data: enforced, error } = await rpc('get_setting', { _org_id: orgId, _key: 'auth.mfa_enforced' });
      if (error) {
        // Не удалось узнать правило: не запираем людей из-за сетевой ошибки.
        console.error('Error reading MFA setting:', error);
        if (!cancelled) setState('ok');
        return;
      }
      if (enforced !== true) { if (!cancelled) setState('ok'); return; }
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!cancelled) setState(aal?.currentLevel === 'aal2' ? 'ok' : 'needs-mfa');
    })();
    return () => { cancelled = true; };
  }, [orgId, orgLoading]);

  if (state === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (state === 'needs-mfa') return <Navigate to="/security" replace />;
  return <>{children}</>;
};
