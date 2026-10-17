import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { fixtures, renderPage, resetFixtures } from '@/test/harness';
import snapshot from '@/test/fixtures/live.json';
import Bdr from '@/pages/cash/Bdr';
import PaymentCalendar from '@/pages/cash/PaymentCalendar';
import CashPage from '@/pages/cash/CashPage';
import AnalyticsPage from '@/pages/analytics/AnalyticsPage';
import Dashboards from '@/pages/analytics/Dashboards';
import Deals from '@/pages/deals/Deals';
import DocumentControl from '@/pages/workers/DocumentControl';
import RotationCalendar from '@/pages/orders/RotationCalendar';
import ClientAnalytics from '@/pages/client/ClientAnalytics';

// Страницы на НАСТОЯЩИХ ответах сервера по демо-организации (снимок scripts/capture-fixtures.mjs): формы чисел, null, порядок полей.
const snap = snapshot as unknown as { rpc: Record<string, unknown>; tables: Record<string, unknown[]>; clientDashboard: unknown[]; clientId: string };

describe('страницы на реальных ответах сервера', () => {
  beforeEach(() => {
    resetFixtures('director');
    Object.assign(fixtures.rpc, snap.rpc);
    Object.assign(fixtures.tables, snap.tables);
  });

  it('БДР: выручка, затраты на вахту, отклонения', async () => {
    renderPage(<Bdr />);
    expect(await screen.findByText('БДР: план и факт')).toBeTruthy();
    expect((await screen.findAllByText('Выручка')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Чистая прибыль')).length).toBeGreaterThan(0);
  });

  it('Платёжный календарь с реальным разрывом', async () => {
    renderPage(<PaymentCalendar />);
    await waitFor(() => expect(screen.getAllByText(/разрыв/i).length).toBeGreaterThan(0));
  });

  it('Деньги: остатки и операции', async () => {
    renderPage(<CashPage />);
    expect((await screen.findAllByText(/Расчётный счёт|Т-Банк|Основной/)).length).toBeGreaterThan(0);
  });

  it('Аналитика и график', async () => {
    renderPage(<AnalyticsPage />);
    expect(await screen.findByLabelText('Выручка: показать записи')).toBeTruthy();
    expect(await screen.findByRole('img', { name: /График выручки/ })).toBeTruthy();
  });

  for (const [role, tab, expected] of [
    ['director', 'Руководитель', 'ТЕСТ Логистик'],
    ['site_manager', 'Ведение объектов', 'ТЕСТ Склад Север'],
    ['recruiter', 'Найм', 'Новые'],
    ['sales', 'Продажи', 'Воронка сделок'],
    ['accountant', 'Бухгалтерия', 'Дебиторка по срокам'],
  ] as const) {
    it(`Дашборд «${tab}»`, async () => {
      resetFixtures(role);
      Object.assign(fixtures.rpc, snap.rpc);
      renderPage(<Dashboards />);
      expect(await screen.findByRole('tab', { name: tab })).toBeTruthy();
      expect((await screen.findAllByText(new RegExp(expected))).length).toBeGreaterThan(0);
    });
  }

  it('Сделки: канбан по реальным сделкам', async () => {
    renderPage(<Deals />);
    expect(await screen.findByText('Сортировка посылок')).toBeTruthy();
    expect(screen.getByText('КП отправлено', { selector: 'h2' })).toBeTruthy();
  });

  it('Контроль документов: просроченные и истекающие', async () => {
    renderPage(<DocumentControl />);
    expect((await screen.findAllByText('Медицинская книжка')).length).toBeGreaterThan(0);
  });

  it('Календарь вахт', async () => {
    renderPage(<RotationCalendar />);
    expect(await screen.findByText('Проживание: свободные места')).toBeTruthy();
  });

  it('Показатели в кабинете заказчика', async () => {
    resetFixtures('client_admin');
    fixtures.tables.clients = [{ id: snap.clientId, name: 'ТЕСТ Логистик' }];
    fixtures.rpc.client_dashboard = snap.clientDashboard;
    renderPage(<ClientAnalytics />);
    expect(await screen.findByText('Показатели', { selector: 'h1' })).toBeTruthy();
    expect((await screen.findAllByText(/ТЕСТ Склад/)).length).toBeGreaterThan(0);
  });
});
