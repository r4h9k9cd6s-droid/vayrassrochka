import { describe, expect, it } from 'vitest';
import { Client, makeTestApp, type App } from './testing.js';

const shop = { sellerType: 'shop', seller: { name: 'Техномир', phone: '8 (928) 111-22-33' } };
const item = {
  title: 'iPhone 15',
  cost: 80000,
  downPayment: 20000,
  termMonths: 6,
  purchaseDate: '2026-01-10',
  paymentDay: 15,
  ...shop,
};

async function login(app: App, name = 'user1') {
  const c = new Client(app);
  await c.call('POST', '/api/auth/register', { login: name, password: 'password-1' });
  return c;
}

describe('рассрочки', () => {
  it('создание: ярлык по названию, график, продавец', async () => {
    const { app } = await makeTestApp(); // «сегодня» 2026-03-10
    const c = await login(app);
    const r = await c.call('POST', '/api/installments', item);
    expect(r.status).toBe(201);
    expect(r.body.installment).toMatchObject({ icon: 'phone', category: 'electronics', published: false });
    expect(r.body.installment.seller.phone).toBe('79281112233');
    expect(r.body.state.regularPayment).toBe(10000);
    // фев просрочен (15.02), март ближайший → 20 000 к оплате сейчас
    expect(r.body.state.dueNow).toEqual({ overdue: 10000, next: 10000, total: 20000, isOverdue: true });
  });

  it('платёж, пропуск, отмена; чужие данные недоступны', async () => {
    const { app } = await makeTestApp();
    const c = await login(app);
    const id = (await c.call('POST', '/api/installments', item)).body.installment.id;

    const p = await c.call('POST', `/api/installments/${id}/events`, { type: 'payment', date: '2026-03-10', amount: 10000 });
    expect(p.status).toBe(201);
    expect(p.body.state.overdueAmount).toBe(0);
    expect(p.body.state.remaining).toBe(50000);

    const s = await c.call('POST', `/api/installments/${id}/events`, { type: 'skip', date: '2026-03-10' });
    expect(s.body.state.segments.some((x: { status: string }) => x.status === 'skipped')).toBe(true);
    expect(s.body.state.remaining).toBe(50000);

    const skipId = s.body.events.find((e: { type: string }) => e.type === 'skip').id;
    const v = await c.call('POST', `/api/installments/${id}/events/${skipId}/void`);
    expect(v.body.state.segments.some((x: { status: string }) => x.status === 'skipped')).toBe(false);
    expect(v.body.events).toHaveLength(2); // история сохранена

    const other = await login(app, 'user2');
    expect((await other.call('GET', `/api/installments/${id}`)).status).toBe(404);
    expect((await other.call('POST', `/api/installments/${id}/events`, { type: 'payment', date: '2026-03-10', amount: 1 })).status).toBe(404);
  });

  it('пропуск там, где нельзя, и платёж по закрытой рассрочке отклоняются', async () => {
    const { app } = await makeTestApp();
    const c = await login(app);
    const id = (await c.call('POST', '/api/installments', item)).body.installment.id;
    const bad = await c.call('POST', `/api/installments/${id}/events`, { type: 'skip', date: '2026-03-10', segmentId: 'o5' });
    expect(bad.status).toBe(422);
    await c.call('POST', `/api/installments/${id}/events`, { type: 'payment', date: '2026-03-10', amount: 60000 });
    const more = await c.call('POST', `/api/installments/${id}/events`, { type: 'payment', date: '2026-03-11', amount: 100 });
    expect(more.status).toBe(422);
  });

  it('личная запись не публикуется; для публикации нужно подтверждение', async () => {
    const { app } = await makeTestApp();
    const c = await login(app);
    const personal = await c.call('POST', '/api/installments', { ...item, sellerType: 'none', seller: undefined, published: true, rightsConfirmed: true });
    expect(personal.body.error).toBe('personal_not_publishable');
    const noRights = await c.call('POST', '/api/installments', { ...item, published: true });
    expect(noRights.body.error).toBe('rights_not_confirmed');
    const noSeller = await c.call('POST', '/api/installments', { ...item, seller: {} });
    expect(noSeller.body.error).toBe('seller_required');
    const ok = await c.call('POST', '/api/installments', { ...item, sellerType: 'none', seller: undefined });
    expect(ok.status).toBe(201);
    expect(ok.body.installment.seller).toBeNull();
    const later = await c.call('PATCH', `/api/installments/${ok.body.installment.id}`, { sellerType: 'shop', seller: { name: 'Магазин' }, published: true, rightsConfirmed: true });
    expect(later.body.installment.published).toBe(true);
  });

  it('один продавец на много покупок (имя без учёта регистра, телефон в любом формате)', async () => {
    const { app } = await makeTestApp();
    const c = await login(app);
    const a = await c.call('POST', '/api/installments', item);
    const b = await c.call('POST', '/api/installments', { ...item, seller: { name: ' ТЕХНОМИР ', phone: '+7 928 111 22 33' } });
    expect(b.body.installment.seller.id).toBe(a.body.installment.seller.id);
    const p = await c.call('POST', '/api/installments', { ...item, sellerType: 'person', seller: { name: 'Магомед Иванов', phone: '89181234567' } });
    expect(p.body.installment.seller.name).toBe('Магомед И.');
  });

  it('удаление и список', async () => {
    const { app } = await makeTestApp();
    const c = await login(app);
    const id = (await c.call('POST', '/api/installments', item)).body.installment.id;
    expect((await c.call('GET', '/api/installments')).body.items).toHaveLength(1);
    await c.call('DELETE', `/api/installments/${id}`);
    expect((await c.call('GET', '/api/installments')).body.items).toHaveLength(0);
  });
});
