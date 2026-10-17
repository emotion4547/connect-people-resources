import { db } from '@/lib/db';

const urlBase64ToUint8Array = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!import.meta.env.VITE_VAPID_PUBLIC_KEY;

// Подписывает этот браузер на push и сохраняет подписку как адрес доставки человека.
export async function enablePush(orgId: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Уведомления в браузере запрещены. Разрешите их в настройках сайта.');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY as string),
  });
  const { error } = await db('notification_contacts').upsert(
    { org_id: orgId, channel: 'push', address: JSON.stringify(sub.toJSON()), is_active: true },
    { onConflict: 'user_id,channel,address', ignoreDuplicates: true },
  );
  if (error) throw error;
}
