import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '@testing-library/react';
import { vi } from 'vitest';

// Подмена слоя данных: таблицы отдают заготовленные строки, функции — заготовленные ответы.
import liveTables from './fixtures/live-tables.json';

export const fixtures: {
  tables: Record<string, unknown[]>;
  rpc: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>;
  role: string;
  useLive: boolean;
  calls: { fn: string; args: Record<string, unknown> | undefined }[];
} = { tables: {}, rpc: {}, role: 'director', useLive: false, calls: [] };

export const resetFixtures = (role = 'director') => { fixtures.tables = {}; fixtures.rpc = {}; fixtures.role = role; fixtures.useLive = false; fixtures.calls = []; };

const rowsOf = (table: string): unknown[] => fixtures.tables[table] ?? (fixtures.useLive ? ((liveTables as Record<string, unknown[]>)[table] ?? []) : []);

const chain = (rows: unknown[]) => {
  const result = { data: rows, error: null, count: rows.length };
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve({ data: rows[0] ?? null, error: null });
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
};

export const dbMock = {
  db: (table: string) => chain(rowsOf(table)),
  rpc: (fn: string, args?: Record<string, unknown>) => {
    fixtures.calls.push({ fn, args });
    const f = fixtures.rpc[fn];
    const data = typeof f === 'function' ? (f as (a?: Record<string, unknown>) => unknown)(args) : f;
    return Promise.resolve({ data: data ?? [], error: null });
  },
  invokeFunction: () => Promise.resolve({ data: {}, error: null }),
};

export const renderPage = (ui: React.ReactElement, path = '/', route = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path={route} element={ui} /></Routes>
    </MemoryRouter>,
  );


// Заглушка клиента Supabase для страниц, которые обращаются к нему напрямую: сети в тестах нет.
export const supabaseStub = {
  from: (table: string) => chain(rowsOf(table)),
  rpc: dbMock.rpc,
  functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
  storage: { from: () => ({ upload: async () => ({ data: null, error: null }), createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }), remove: async () => ({ data: null, error: null }), list: async () => ({ data: [], error: null }) }) },
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: { id: 'u1', email: 'test@test.local' } }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    mfa: { listFactors: async () => ({ data: { totp: [], all: [] }, error: null }), getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }) },
    signOut: async () => ({ error: null }),
  },
  channel: () => { const ch = { on: () => ch, subscribe: () => ch, unsubscribe: () => {} }; return ch; },
  removeChannel: () => {},
};
