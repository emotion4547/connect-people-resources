import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { fixtures, renderPage, resetFixtures } from '@/test/harness';
import Bdr from '@/pages/cash/Bdr';
import PaymentCalendar from '@/pages/cash/PaymentCalendar';
import CashReport from '@/pages/cash/CashReport';
import AnalyticsPage from '@/pages/analytics/AnalyticsPage';
import Dashboards from '@/pages/analytics/Dashboards';
import Deals from '@/pages/deals/Deals';
import DealDetail from '@/pages/deals/DealDetail';
import DocumentControl from '@/pages/workers/DocumentControl';
import RotationCalendar from '@/pages/orders/RotationCalendar';
import ImportPage from '@/pages/import/ImportPage';
import CashPage from '@/pages/cash/CashPage';
import AdminErrors from '@/pages/admin/AdminErrors';

const today = new Date().toISOString().slice(0, 10);
const month = `${today.slice(0, 7)}-01`;

describe('страницы этапа 3 отрисовываются на ответах сервера', () => {
  beforeEach(() => resetFixtures('director'));

  it('БДР: план/факт, отклонения, разрезы', async () => {
    fixtures.rpc.bdr_report = [
      { month, article: 'revenue', article_name: 'Выручка', sort_order: 10, plan: '20000', fact: '13500' },
      { month, article: 'worker_costs', article_name: 'Затраты на исполнителей', sort_order: 20, plan: '9000', fact: '9000' },
      { month, article: 'rotation_costs', article_name: 'Проживание и питание вахт', sort_order: 55, plan: '0', fact: '7500' },
    ];
    fixtures.rpc.bdr_breakdown = [{ key: 'c1', name: 'Заказчик 1', revenue: '13500', worker_costs: '9000', margin: '4500', margin_pct: 33.3 }];
    renderPage(<Bdr />);
    expect(await screen.findByText('БДР: план и факт')).toBeTruthy();
    expect((await screen.findAllByText('Проживание и питание вахт')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/13\s?500/).length).toBeGreaterThan(0);
  });

  it('Платёжный календарь: разрыв подсвечен', async () => {
    fixtures.rpc.payment_calendar = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() + i * 86400000).toISOString().slice(0, 10);
      return { day: d, balance_open: '1000', in_invoices: '0', in_plan: '0', in_manual: '0', out_registries: '0', out_accrued: i === 2 ? '5000' : '0', out_plan: '0', out_manual: '0', balance_close: i >= 2 ? '-4000' : '1000', gap: i >= 2 };
    });
    renderPage(<PaymentCalendar />);
    await waitFor(() => expect(screen.getAllByText(/разрыв/i).length).toBeGreaterThan(0));
  });

  it('Отчёт ДДС отрисовывается', async () => {
    fixtures.rpc.cashflow_report = [{ month, article: 'rent', article_name: 'Аренда', direction: 'out', bdr_article: 'admin_costs', amount_in: '0', amount_out: '20000', entries: 1 }];
    fixtures.rpc.cash_total_balance = '130000';
    renderPage(<CashReport />);
    expect(await screen.findByText('Отчёт ДДС')).toBeTruthy();
    expect(await screen.findByText(/Аренда/)).toBeTruthy();
  });

  const metrics = [
    { metric: 'staffing', name: 'Укомплектованность', unit: '%', value: 66.7, prev_value: 50, delta: 16.7, sort_order: 10 },
    { metric: 'revenue', name: 'Выручка', unit: '₽', value: 13500, prev_value: null, delta: null, sort_order: 50 },
  ];

  it('Аналитика: график за 12 месяцев', async () => {
    fixtures.rpc.analytics_compare = metrics;
    fixtures.rpc.analytics_series = [{ bucket: month, needed: 6, confirmed: 4, started_needed: 4, on_site: 2, started_assigned: 4, no_shows: 1, revenue: '13500', worker_costs: '9000', margin: '4500' }];
    renderPage(<AnalyticsPage />);
    expect(await screen.findByRole('img', { name: /График выручки/ })).toBeTruthy();
  });

  it('Аналитика: карточки и открытие записей по клику', async () => {
    fixtures.rpc.analytics_compare = metrics;
    fixtures.rpc.analytics_records = [{ record_id: 'r1', kind: 'shift', label: 'Заказчик · Склад', detail: 'нужно 4, подтвердили 3', record_date: today, amount: 3, link: '/orders/1' }];
    renderPage(<AnalyticsPage />);
    const card = await screen.findByLabelText('Укомплектованность: показать записи');
    expect(card.textContent).toContain('66.7%');
    fireEvent.click(card);
    expect(await screen.findByText('нужно 4, подтвердили 3')).toBeTruthy();
  });

  for (const [role, tab, rpcs] of [
    ['director', 'Руководитель', { analytics_by_client: [{ client_id: 'c1', client_name: 'Клиент А', revenue: '9000', margin: '3000', margin_pct: 33.3, prev_margin_pct: 50, margin_falling: true }], analytics_plan_fact: [{ revenue_plan: '20000', revenue_fact: '9000', margin_plan: null, margin_fact: '3000' }], cash_total_balance: '5000', payment_calendar: [] }],
    ['site_manager', 'Ведение объектов', { analytics_by_site: [{ site_id: 's1', site_name: 'Склад 1', client_name: 'Клиент А', needed: 6, confirmed: 4, started_needed: 4, on_site: 2, started_assigned: 4, no_shows: 1, today_needed: 0, today_confirmed: 0, week_needed: 2, week_confirmed: 1 }], analytics_unconfirmed: [{ assignment_id: 'a1', worker_name: 'Иванов', phone: null, site_name: 'Склад 1', client_name: 'Клиент А', shift_start: today, order_id: 'o1' }] }],
    ['recruiter', 'Найм', { analytics_candidates: [{ dimension: 'source', key: 's', name: 'Сайт', total: 5, admitted: 1 }, { dimension: 'stage', key: 'new', name: 'Новые', total: 3, admitted: 0 }] }],
    ['sales', 'Продажи', { deal_funnel: [{ stage: 'new', deals: 2, revenue: '100000', weighted: '10000' }], deal_lost_reasons: [{ reason: 'Дорого', deals: 2 }], analytics_by_client: [], analytics_plan_fact: [{ revenue_plan: null, revenue_fact: '0', margin_plan: null, margin_fact: '0' }] }],
    ['accountant', 'Бухгалтерия', { client_receivables: [{ debt: '5000', not_due: '1000', overdue_30: '2000', overdue_60: '1000', overdue_60p: '1000' }] }],
  ] as [string, string, Record<string, unknown>][]) {
    it(`Дашборд «${tab}» отрисовывается для роли ${role}`, async () => {
      resetFixtures(role);
      fixtures.rpc.analytics_compare = metrics;
      fixtures.rpc.analytics_counters = [{ key: 'timesheets_pending', name: 'Табели на подтверждении', unit: 'шт.', value: 2, link: '/timesheets', grp: 'ops' }];
      Object.assign(fixtures.rpc, rpcs);
      renderPage(<Dashboards />);
      expect(await screen.findByText('Дашборды')).toBeTruthy();
      expect(await screen.findByRole('tab', { name: tab })).toBeTruthy();
    });
  }

  it('Сделки: канбан, «Мой день», план продаж', async () => {
    fixtures.tables.deals = [{ id: 'd1', org_id: 'org1', title: 'Грузчики на склад', company: 'Логистика', stage: 'qualification', source: 'site_form', owner_id: 'u1', expected_revenue: 100000, expected_margin: 20000, next_step: 'Позвонить', next_step_date: today, contact_name: null, contact_phone: null, contact_email: null, client_id: null, created_at: today }];
    fixtures.tables.staff_profiles = [{ user_id: 'u1', full_name: 'Менеджер' }];
    fixtures.rpc.my_sales_day = [{ kind: 'task', ref_id: 't1', deal_id: 'd1', deal_title: 'Грузчики на склад', title: 'call: Позвонить', due: today, overdue: false }];
    fixtures.rpc.sales_plan_fact = [{ manager_id: 'u1', manager_name: 'Менеджер', month, plan: '500000', fact: '0' }];
    renderPage(<Deals />);
    expect(await screen.findByText('Грузчики на склад')).toBeTruthy();
    expect(screen.getByText('Квалификация', { selector: 'h2' })).toBeTruthy();
  });

  it('Карточка сделки: КП, касания', async () => {
    fixtures.tables.deals = [{ id: 'd1', org_id: 'org1', title: 'Грузчики на склад', stage: 'proposal', source: 'manual', owner_id: 'u1', expected_revenue: 100000, expected_margin: 20000, created_at: today }];
    fixtures.tables.deal_quotes = [{ id: 'q1', deal_id: 'd1', version: 1, lines: [{ position_id: 'p1', unit: 'hour', client_rate: 450, worker_rate: 300, headcount: 5, hours_per_month: 800 }], valid_until: null, note: null, sent_at: null, sent_to: null, created_at: today }];
    fixtures.tables.positions = [{ id: 'p1', name: 'Грузчик' }];
    fixtures.tables.deal_touches = [{ id: 't1', kind: 'call', title: 'Созвон', note: null, due_at: today, done_at: null }];
    renderPage(<DealDetail />, '/deals/d1', '/deals/:id');
    expect(await screen.findByText('Версия 1')).toBeTruthy();
    expect(screen.getByText('Созвон')).toBeTruthy();
  });

  it('Контроль документов: реестр и конфликты', async () => {
    fixtures.rpc.document_registry = [{ kind: 'document', doc_id: 'x1', worker_id: 'w1', worker_name: 'Иванов', phone: '+7900', type_id: 't', type_name: 'Медицинская книжка', number_masked: '**12', valid_until: today, days_left: -3, status: 'verified', next_site: 'Склад 1', total: 1 }];
    fixtures.rpc.document_conflicts = [{ assignment_id: 'a1', shift_id: 's1', worker_id: 'w1', worker_name: 'Иванов', shift_date: today, site_id: 'st', site_name: 'Склад 1', problem: 'Нет действующего документа: Медицинская книжка' }];
    renderPage(<DocumentControl />);
    expect(await screen.findByText('Медицинская книжка')).toBeTruthy();
    expect(await screen.findByText(/просрочен на 3 дн\./)).toBeTruthy();
  });

  it('Календарь вахт', async () => {
    fixtures.rpc.rotation_calendar = [{ order_id: 'o1', site_name: 'Посёлок', client_name: 'Заказчик', housing_address: 'Общежитие', worker_id: 'w1', worker_name: 'Иванов', arrival_date: today, departure_date: today }];
    fixtures.rpc.rotation_housing_load = [{ order_id: 'o1', housing_address: 'Общежитие', site_name: 'Посёлок', day: today, beds: 2, occupied: 3, free: -1 }];
    renderPage(<RotationCalendar />);
    expect(await screen.findByText('Календарь вахт')).toBeTruthy();
    expect(await screen.findByText('Проживание: свободные места')).toBeTruthy();
  });

  it('Деньги: остатки и окно счетов', async () => {
    fixtures.tables.cash_accounts = [{ id: 'a1', kind: 'bank', name: 'Т-Банк', bank_name: 'Т-Банк', account_number: '4070', opening_balance: 250000, opening_date: today, is_active: true, sort_order: 10 }];
    fixtures.rpc.cash_balances = [{ account_id: 'a1', balance: '250000' }];
    renderPage(<CashPage />);
    expect((await screen.findAllByText('Т-Банк')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Счета' }));
    expect(await screen.findByText(/Остаток на начало и его дата/)).toBeTruthy();
    expect(screen.getByText('Добавить счёт')).toBeTruthy();
  });

  it('Журнал ошибок интерфейса', async () => {
    fixtures.tables.client_errors = [{ id: 'e1', role: 'sales', message: 'TypeError: x is undefined', stack: 'at Foo', url: '/deals/1', user_agent: 'Chrome', created_at: new Date().toISOString() }];
    renderPage(<AdminErrors />);
    expect(await screen.findByText('TypeError: x is undefined')).toBeTruthy();
    fireEvent.click(screen.getByText('TypeError: x is undefined'));
    expect(await screen.findByText(/at Foo/)).toBeTruthy();
  });

  it('Импорт: вкладки и шаблон', async () => {
    renderPage(<ImportPage />);
    expect(await screen.findByText('Импорт из Excel', { selector: 'h1' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Тарифы' })).toBeTruthy();
    expect(screen.getByText('Скачать шаблон')).toBeTruthy();
  });
});
