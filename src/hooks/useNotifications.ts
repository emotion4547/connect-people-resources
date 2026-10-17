import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/lib/db';

// Число непрочитанных уведомлений; обновляется раз в полминуты и при возврате на вкладку.
export function useUnreadNotifications() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    const { count: c } = await db('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false);
    setCount(c ?? 0);
  }, [user]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    const vis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [refresh]);

  return { count, refresh };
}
