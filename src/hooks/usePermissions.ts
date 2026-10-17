import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/contexts/OrgContext';
import { rpc } from '@/lib/db';

export type Scope = 'none' | 'own' | 'department' | 'all';

// Права текущего пользователя в выбранной организации (матрица ролей, ТЗ раздел 2).
// Это подсказка интерфейсу: что показывать. Защищает данные сама база.
export function usePermissions() {
  const { orgId } = useOrg();
  const [map, setMap] = useState<Map<string, Scope>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) { setMap(new Map()); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    rpc('my_permissions', { _org_id: orgId }).then(({ data, error }: { data: { module: string; action: string; scope: Scope }[] | null; error: unknown }) => {
      if (cancelled) return;
      if (error) console.error('Error loading permissions:', error);
      setMap(new Map((data ?? []).map((p) => [`${p.module}/${p.action}`, p.scope])));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [orgId]);

  const scope = useCallback((module: string, action: string): Scope => map.get(`${module}/${action}`) ?? 'none', [map]);
  const can = useCallback((module: string, action: string) => scope(module, action) !== 'none', [scope]);

  return { scope, can, loading };
}
