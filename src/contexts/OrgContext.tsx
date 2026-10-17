import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// Организации появились после генерации src/integrations/supabase/types.ts,
// поэтому обращение к ним идёт мимо сгенерированных типов.
export interface Organization {
  id: string;
  name: string;
  legal_form: string;
  is_active: boolean;
}

interface OrgContextValue {
  orgs: Organization[];
  orgId: string | null;
  org: Organization | null;
  setOrgId: (id: string) => void;
  reload: () => Promise<void>;
  loading: boolean;
}

const OrgContext = createContext<OrgContextValue | undefined>(undefined);
const STORAGE_KEY = 'selected-org';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const orgTable = () => (supabase as any).from('organizations');

export const OrgProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, role } = useAuth();
  // Исполнителям и заказчикам список организаций не нужен: только сотрудникам.
  const isStaff = !!role && !['worker', 'hr', 'client_admin', 'client_manager'].includes(role);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgId, setOrgIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!user || !isStaff) {
      setOrgs([]);
      setOrgIdState(null);
      return;
    }
    setLoading(true);
    const { data, error } = await orgTable().select('id,name,legal_form,is_active').order('created_at');
    setLoading(false);
    if (error) {
      console.error('Error fetching organizations:', error);
      return;
    }
    const list: Organization[] = data ?? [];
    setOrgs(list);
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* хранилище недоступно — берём первую */ }
    setOrgIdState((prev) => {
      const wanted = prev ?? saved;
      return list.find((o) => o.id === wanted)?.id ?? list[0]?.id ?? null;
    });
  }, [user, isStaff]);

  useEffect(() => { reload(); }, [reload]);

  const setOrgId = useCallback((id: string) => {
    setOrgIdState(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch { /* не критично */ }
  }, []);

  const value = useMemo<OrgContextValue>(() => ({
    orgs, orgId, org: orgs.find((o) => o.id === orgId) ?? null, setOrgId, reload, loading,
  }), [orgs, orgId, setOrgId, reload, loading]);

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useOrg = () => {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
};
