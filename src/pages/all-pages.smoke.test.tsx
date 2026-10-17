import React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, waitFor } from '@testing-library/react';
import { fixtures, resetFixtures } from '@/test/harness';

// Каждая страница приложения должна отрисоваться на настоящих строках демо-организации без исключений.
// Данные функций (rpc) пустые: проверяется разбор строк таблиц и первичная отрисовка.
const modules = import.meta.glob('/src/pages/**/*.tsx');
const SKIP = [/\.test\.tsx$/, /\/Index\.tsx$/, /\/NotFound\.tsx$/, /\/Install\.tsx$/, /\/Login\.tsx$/, /\/SetPassword\.tsx$/, /\/Contact\.tsx$/, /\/PrivacyPolicy\.tsx$/, /\/Terms\.tsx$/, /\/Workspace\.tsx$/];
const ROLE_BY_DIR: [RegExp, string][] = [[/\/worker\//, 'worker'], [/\/client\//, 'client_admin'], [/\/hr\//, 'hr'], [/\/admin\//, 'admin']];

describe('все страницы отрисовываются на живых строках демо-организации', () => {
  beforeEach(() => resetFixtures('director'));

  for (const [path, load] of Object.entries(modules)) {
    if (SKIP.some((re) => re.test(path))) continue;
    it(path.replace('/src/pages/', ''), async () => {
      const role = ROLE_BY_DIR.find(([re]) => re.test(path))?.[1] ?? 'director';
      resetFixtures(role);
      fixtures.useLive = true;
      const mod = (await load()) as { default?: React.ComponentType };
      expect(mod.default, 'у страницы нет экспорта по умолчанию').toBeTruthy();
      const Page = mod.default!;
      const errors: unknown[] = [];
      const onError = (e: ErrorEvent) => { errors.push(e.error ?? e.message); e.preventDefault(); };
      window.addEventListener('error', onError);
      const view = render(
        <MemoryRouter initialEntries={['/p/00000000-0000-0000-0000-000000000001/1/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000001']}>
          <Routes><Route path="/p/:id/:version/:clientId/:orderId" element={<Page />} /></Routes>
        </MemoryRouter>,
      );
      await waitFor(() => expect(view.container.innerHTML.length).toBeGreaterThan(0));
      await new Promise((r) => setTimeout(r, 60));
      window.removeEventListener('error', onError);
      expect(errors).toEqual([]);
    });
  }
});
