import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '@testing-library/react';
import { vi } from 'vitest';

// Подмена слоя данных: таблицы отдают заготовленные строки, функции — заготовленные ответы.
export const fixtures: {
  tables: Record<string, unknown[]>;
  rpc: Record<string, unknown | ((args: Record<string, unknown>) => unknown)>;
  role: string;
  calls: { fn: string; args: Record<string, unknown> | undefined }[];
} = { tables: {}, rpc: {}, role: 'director', calls: [] };

export const resetFixtures = (role = 'director') => { fixtures.tables = {}; fixtures.rpc = {}; fixtures.role = role; fixtures.calls = []; };

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
  db: (table: string) => chain(fixtures.tables[table] ?? []),
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

