import { describe, expect, it } from 'vitest';
import { runReminders, type PushSender } from './push.js';
import { schema } from './db/index.js';
import { Client, makeTestApp } from './testing.js';

const inst = (extra = {}) => ({
  title: 'Диван', cost: 56000, downPayment: 0, termMonths: 4, purchaseDate: '2026-01-10', paymentDay: 15,
  sellerType: 'shop', seller: { name: 'Мебель' }, ...extra,
}); // 4 × 14 000: 15 фев, 15 мар, 15 апр, 15 май

async function setup() {
  const t = await makeTestApp(); // сегодня 2026-03-10, 12:00 по Грозному (UTC+3)
  const c = new Client(t.app);
  await c.call('POST', '/api/auth/register', { login: 'user1', password: 'password-1' });
  return { ...t, c };
}

describe('Главная', () => {
  it('сводка месяца: просрочка, ближайший платёж, котёл, напоминание о коде', async () => {
    const { c } = await setup();
    await c.call('POST', '/api/installments', inst());
    await c.call('POST', '/api/pots', { name: 'Котёл', participants: 6, contribution: 3000, paymentDay: 20, myTurn: 3, startDate: '2026-01-01', alreadyPaid: 2 });
    const h = (await c.call('GET', '/api/home')).body;
    expect(h.month).toBe('2026-03');
    // просрочено: фев 14 000 + котёл март? (20 марта ещё впереди) → только рассрочка
    // котёл: янв, фев оплачены (внесено 2); март (20-е) впереди
    expect(h.summary.overdue).toBe(14000);
    expect(h.summary.installments.left).toBe(14000 + 14000); // просрочка + мартовский платёж
    expect(h.summary.pots.left).toBe(3000);
    expect(h.summary.total).toBe(31000);
    const kinds = h.attention.map((a: { kind: string }) => a.kind);
    expect(kinds).toEqual(['overdue', 'next_payment', 'backup_code']);
    expect(h.receive[0]).toMatchObject({ amount: 18000, month: 3 });
    await c.call('POST', '/api/me/backup-code/ack');
    expect((await c.call('GET', '/api/home')).body.attention.map((a: { kind: string }) => a.kind)).not.toContain('backup_code');
  });

  it('оплаченное попадает в «оплачено», просьба проверить продавца — в «Требует внимания»', async () => {
    const { app, c } = await setup();
    const id = (await c.call('POST', '/api/installments', inst({ published: true, rightsConfirmed: true }))).body.installment.id;
    await c.call('POST', `/api/installments/${id}/events`, { type: 'payment', date: '2026-03-10', amount: 28000 });
    const r = new Client(app);
    await r.call('POST', '/api/auth/register', { login: 'reader', password: 'password-1' });
    await r.call('POST', `/api/feed/${id}/contact`, { result: 'no' });
    const h = (await c.call('GET', '/api/home')).body;
    expect(h.summary.overdue).toBe(0);
    expect(h.summary.paid).toBe(14000); // платёж, срок которого в марте (фев был оплачен в марте и не считается «мартовским»)
    expect(h.attention.find((a: { kind: string }) => a.kind === 'check_seller')).toMatchObject({ count: 1, installmentId: id });
  });

  it('нужна авторизация', async () => {
    const { app } = await makeTestApp();
    expect((await new Client(app).call('GET', '/api/home')).status).toBe(401);
  });
});

describe('push-уведомления', () => {
  const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } };

  it('за день, в день платежа и о просрочке; повторно не шлёт; время настраивается', async () => {
    const { c, ctx, clock } = await setup();
    await c.call('POST', '/api/installments', inst());
    await c.call('POST', '/api/push/subscribe', sub);
    const calls: string[] = [];
    const send: PushSender = async (_t, p) => (calls.push(`${p.title}|${p.body}`), { ok: true });

    // 14.03 12:00 по Грозному: платёж 15-го «завтра», февральский просрочен
    clock.current = new Date('2026-03-14T09:00:00Z');
    await runReminders(ctx, send);
    expect(calls).toContain('Платёж просрочен|Диван: 14 000 ₽');
    expect(calls.some((x) => x.startsWith('Платёж завтра'))).toBe(true);
    const n = calls.length;
    await runReminders(ctx, send);
    expect(calls).toHaveLength(n); // повторно не отправляет

    clock.current = new Date('2026-03-15T09:00:00Z');
    await runReminders(ctx, send);
    expect(calls.some((x) => x.startsWith('Платёж сегодня'))).toBe(true);

    // до выбранного времени не шлёт
    await c.call('PATCH', '/api/me/settings', { reminderTime: '20:00' });
    clock.current = new Date('2026-04-14T09:00:00Z'); // 12:00 < 20:00
    const before = calls.length;
    await runReminders(ctx, send);
    expect(calls).toHaveLength(before);
  });

  it('выключенные уведомления и отсутствие подписки — ничего не отправляется', async () => {
    const { c, ctx, clock } = await setup();
    await c.call('POST', '/api/installments', inst());
    clock.current = new Date('2026-03-14T09:00:00Z');
    const send: PushSender = async () => ({ ok: true });
    expect((await runReminders(ctx, send)).sent).toBe(0); // нет подписки
    await c.call('POST', '/api/push/subscribe', sub);
    await c.call('PATCH', '/api/me/settings', { pushEnabled: false });
    expect((await runReminders(ctx, send)).sent).toBe(0);
  });

  it('повторные попытки при ошибке (до 3), недействительная подписка удаляется', async () => {
    const { c, ctx, clock, db } = await setup();
    await c.call('POST', '/api/installments', inst());
    await c.call('POST', '/api/push/subscribe', sub);
    clock.current = new Date('2026-03-14T09:00:00Z');
    let attempts = 0;
    const flaky: PushSender = async () => (attempts++, { ok: false, gone: false, error: 'timeout' });
    for (let i = 0; i < 5; i++) await runReminders(ctx, flaky);
    expect(attempts).toBe(6); // 2 уведомления × 3 попытки
    const gone: PushSender = async () => ({ ok: false, gone: true, error: '410' });
    await c.call('POST', '/api/me/settings', {});
    clock.current = new Date('2026-03-15T09:00:00Z');
    await runReminders(ctx, gone);
    expect(await db.select().from(schema.pushSubscriptions)).toHaveLength(0);
  });

  it('push о просьбе проверить продавца', async () => {
    const { app, c, ctx } = await setup();
    const id = (await c.call('POST', '/api/installments', inst({ published: true, rightsConfirmed: true }))).body.installment.id;
    await c.call('POST', '/api/push/subscribe', sub);
    const r = new Client(app);
    await r.call('POST', '/api/auth/register', { login: 'reader', password: 'password-1' });
    await r.call('POST', `/api/feed/${id}/contact`, { result: 'no' });
    const calls: string[] = [];
    await runReminders(ctx, async (_t, p) => (calls.push(p.title), { ok: true }));
    expect(calls).toContain('Проверьте данные продавца');
  });
});
