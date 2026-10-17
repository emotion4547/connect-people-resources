import { rpc } from '@/lib/db';

// Отправка ошибок интерфейса в журнал (админка → «Журнал ошибок»). Не больше 5 за загрузку страницы; сбой самой отправки молчит.
let sent = 0;
const seen = new Set<string>();

export function reportError(error: unknown, extra?: string) {
  try {
    if (sent >= 5) return;
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error));
    const message = `${err.message}${extra ? ` (${extra})` : ''}`;
    if (seen.has(message)) return;
    seen.add(message); sent++;
    void rpc('log_client_error', { _message: message, _stack: err.stack ?? null, _url: window.location.pathname + window.location.search, _user_agent: navigator.userAgent })
      .then(() => undefined, () => undefined);
  } catch { /* журнал ошибок не должен ронять страницу */ }
}

export function installErrorReporting() {
  window.addEventListener('error', (e) => {
    // Загрузка картинок и скриптов, которых нет, — не ошибка кода
    if (e.error) reportError(e.error);
  });
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));
}
