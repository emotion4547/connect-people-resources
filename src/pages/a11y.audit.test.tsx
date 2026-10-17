import React from 'react';
import { afterAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render } from '@testing-library/react';
import { fixtures, resetFixtures } from '@/test/harness';

// Доступность: автоматическая проверка axe на каждой странице (без цвета — в jsdom нет стилей). Ловит кнопки и поля без названий,
// дубли id, неверные роли. Серьёзные нарушения — ошибка теста.
const modules = import.meta.glob('/src/pages/**/*.tsx');
const SKIP = [/\.test\.tsx$/, /\/Index\.tsx$/, /\/NotFound\.tsx$/, /\/Install\.tsx$/, /\/Login\.tsx$/, /\/SetPassword\.tsx$/, /\/Contact\.tsx$/, /\/PrivacyPolicy\.tsx$/, /\/Terms\.tsx$/, /\/Workspace\.tsx$/];
const ROLE_BY_DIR: [RegExp, string][] = [[/\/worker\//, 'worker'], [/\/client\//, 'client_admin'], [/\/hr\//, 'hr'], [/\/admin\//, 'admin']];

const report: { page: string; rule: string; impact: string; count: number; sample: string }[] = [];
afterAll(() => { if (process.env.A11Y_REPORT) writeFileSync(process.env.A11Y_REPORT, JSON.stringify(report, null, 1)); });

describe('доступность страниц (axe)', () => {
  for (const [path, load] of Object.entries(modules)) {
    if (SKIP.some((re) => re.test(path))) continue;
    it(path.replace('/src/pages/', ''), async () => {
      resetFixtures(ROLE_BY_DIR.find(([re]) => re.test(path))?.[1] ?? 'director');
      fixtures.useLive = true;
      const Page = ((await load()) as { default: React.ComponentType }).default;
      const view = render(
        <MemoryRouter initialEntries={['/p/00000000-0000-0000-0000-000000000001/1/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000001']}>
          <Routes><Route path="/p/:id/:version/:clientId/:orderId" element={<Page />} /></Routes>
        </MemoryRouter>,
      );
      await new Promise((r) => setTimeout(r, 80));
      const result = await axe.run({ include: [[ 'body' ]], exclude: [['input.hidden']] }, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false }, 'aria-valid-attr-value': { enabled: false } }, resultTypes: ['violations'] });
      const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      serious.forEach((v) => report.push({ page: path, rule: v.id, impact: v.impact ?? '', count: v.nodes.length, sample: v.nodes.map((n) => n.html.replace(/class="[^"]*"/, '').slice(0, 220)).join(' || ') }));
      const summary = serious.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 2).map((n) => n.html.slice(0, 90)).join(' | ')}`);
      expect(summary).toEqual([]);
    });
  }
});
