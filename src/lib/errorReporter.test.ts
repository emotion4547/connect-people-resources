import { describe, expect, it } from 'vitest';
import { fixtures, resetFixtures } from '@/test/harness';
import { reportError } from '@/lib/errorReporter';

describe('отправка ошибок интерфейса', () => {
  it('одинаковая ошибка уходит один раз, не больше пяти за страницу', async () => {
    resetFixtures();
    reportError(new Error('A'));
    reportError(new Error('A'));
    for (let i = 0; i < 10; i++) reportError(new Error(`E${i}`));
    await Promise.resolve();
    const sent = fixtures.calls.filter((c) => c.fn === 'log_client_error');
    expect(sent.length).toBe(5);
    expect(sent[0].args?._message).toBe('A');
  });
});
