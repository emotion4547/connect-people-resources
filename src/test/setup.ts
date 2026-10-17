import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// Radix и графики в jsdom требуют этих API.
class RO { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (RO as unknown as typeof ResizeObserver);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? vi.fn();
Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
window.matchMedia = window.matchMedia ?? ((q: string) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }));
window.print = vi.fn();

// Слой данных, контексты и оболочки подменяются для всех тестов страниц.
vi.mock('@/lib/db', async () => (await import('./harness')).dbMock);
vi.mock('@/contexts/AuthContext', async () => {
  const { fixtures } = await import('./harness');
  // Объекты стабильны между вызовами, как в настоящем контексте: иначе эффекты, зависящие от user, зацикливаются
  const user = { id: 'u1', email: 'test@test.local' };
  const profile = { full_name: 'Тест', email: 'test@test.local', company: 'Организация' };
  const signOut = async () => {};
  const cache: { role?: string; value?: unknown } = {};
  return { useAuth: () => { if (cache.role !== fixtures.role) { cache.role = fixtures.role; cache.value = { user, role: fixtures.role, profile, loading: false, signOut, session: null }; } return cache.value; } };
});
vi.mock('@/contexts/OrgContext', () => {
  const org = { id: 'org1', name: 'Организация' };
  const value = { orgId: 'org1', orgs: [org], org, loading: false, setOrgId: () => {}, reload: async () => {} };
  return { useOrg: () => value };
});
vi.mock('@/hooks/usePermissions', () => {
  const value = { can: () => true, scope: () => 'all', loading: false };
  return { usePermissions: () => value };
});
vi.mock('@/components/layouts/AppLayout', async () => {
  const React = await import('react');
  return { AppLayout: ({ children }: { children: unknown }) => React.createElement('div', null, children as never) };
});
vi.mock('@/components/layouts/DashboardLayout', async () => {
  const React = await import('react');
  return { DashboardLayout: ({ children }: { children: unknown }) => React.createElement('div', null, children as never) };
});
vi.mock('@/integrations/supabase/client', async () => ({ supabase: (await import('./harness')).supabaseStub }));
