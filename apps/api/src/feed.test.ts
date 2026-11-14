import { describe, expect, it } from 'vitest';
import { schema } from './db/index.js';
import { runFeedMaintenance } from './routes/feed.js';
import { Client, makeTestApp, type App } from './testing.js';

const base = { cost: 60000, downPayment: 0, termMonths: 6, purchaseDate: '2026-01-10', paymentDay: 15, published: true, rightsConfirmed: true };
const shopItem = (title: string, extra = {}) => ({ ...base, title, sellerType: 'shop', seller: { name: 'Техномир', phone: '89281112233', address: 'Грозный' }, ...extra });

async function user(app: App, name: string) {
  const c = new Client(app);
  await c.call('POST', '/api/auth/register', { login: name, password: 'password-1' });
  return c;
}

describe('лента', () => {
  it('публичная запись не содержит автора, платежей и личных финансов', async () => {
    const { app } = await makeTestApp();
    const a = await user(app, 'author');
    const id = (await a.call('POST', '/api/installments', shopItem('Диван угловой'))).body.installment.id;
    await a.call('POST', `/api/installments/${id}/events`, { type: 'payment', date: '2026-03-10', amount: 5000 });
    const guest = new Client(app);
    const feed = await guest.call('GET', '/api/feed');
    expect(feed.body.items).toHaveLength(1);
    const dump = JSON.stringify(feed.body);
    for (const bad of ['author', 'userId', 'events', 'remaining', 'totalPaid', '5000']) expect(dump).not.toContain(bad);
    expect(feed.body.items[0]).toMatchObject({ monthlyPayment: 10000, category: 'furniture', seller: { type: 'shop', name: 'Техномир' } });
  });

  it('личные записи и неопубликованные в ленту не попадают', async () => {
    const { app } = await makeTestApp();
    const a = await user(app, 'author');
    await a.call('POST', '/api/installments', shopItem('Скрытая', { published: false, rightsConfirmed: false }));
    await a.call('POST', '/api/installments', { ...base, published: false, rightsConfirmed: false, title: 'Личная', sellerType: 'none' });
    expect((await new Client(app).call('GET', '/api/feed')).body.items).toHaveLength(0);
  });

  it('гость не видит данные частных лиц, вошедший видит', async () => {
    const { app } = await makeTestApp();
    const a = await user(app, 'author');
    await a.call('POST', '/api/installments', shopItem('Ноутбук', { sellerType: 'person', seller: { name: 'Магомед Иванов', phone: '89181234567' } }));
    const g = (await new Client(app).call('GET', '/api/feed')).body.items[0];
    expect(g.seller).toEqual({ type: 'person', hidden: true });
    const b = await user(app, 'reader');
    expect((await b.call('GET', '/api/feed')).body.items[0].seller).toMatchObject({ name: 'Магомед И.', phone: '79181234567' });
  });

  it('фильтры, поиск и сортировка', async () => {
    const { app } = await makeTestApp();
    const a = await user(app, 'author');
    await a.call('POST', '/api/installments', shopItem('iPhone 15', { cost: 90000, termMonths: 9 }));
    await a.call('POST', '/api/installments', shopItem('Диван', { cost: 30000, termMonths: 12 }));
    await a.call('POST', '/api/installments', shopItem('Кухня', { cost: 120000, termMonths: 24, seller: { name: 'Мебель-Сити' } }));
    const g = new Client(app);
    const titles = async (qs: string) => (await g.call('GET', `/api/feed?${qs}`)).body.items.map((i: { title: string }) => i.title);
    expect(await titles('category=furniture&sort=price')).toEqual(['Диван', 'Кухня']);
    expect(await titles('maxMonthly=5000&sort=monthly')).toEqual(['Диван', 'Кухня']);
    expect(await titles('term=over12')).toEqual(['Кухня']);
    expect(await titles('term=6to12&sort=price')).toEqual(['Диван', 'iPhone 15']);
    expect(await titles('q=%D0%BC%D0%B5%D0%B1%D0%B5%D0%BB%D1%8C')).toEqual(['Кухня']); // по продавцу «Мебель»
    expect(await titles('q=IPHONE')).toEqual(['iPhone 15']);
  });

  it('«N новые покупки»', async () => {
    const { app, clock } = await makeTestApp();
    const a = await user(app, 'author');
    await a.call('POST', '/api/installments', shopItem('Первая'));
    const since = clock.current.toISOString();
    clock.current = new Date(clock.current.getTime() + 60_000);
    await a.call('POST', '/api/installments', shopItem('Вторая'));
    const g = new Client(app);
    expect((await g.call('GET', `/api/feed/new-count?since=${encodeURIComponent(since)}`)).body.count).toBe(1);
    expect((await a.call('GET', `/api/feed/new-count?since=${encodeURIComponent(since)}`)).body.count).toBe(0);
  });

  it('«Удалось связаться?»: да, нет, отмена, один ответ, свою запись нельзя', async () => {
    const { app } = await makeTestApp();
    const a = await user(app, 'author');
    const id = (await a.call('POST', '/api/installments', shopItem('Телефон'))).body.installment.id;
    const b = await user(app, 'reader1');
    const c = await user(app, 'reader2');
    expect((await a.call('POST', `/api/feed/${id}/contact`, { result: 'yes' })).status).toBe(403);
    expect((await new Client(app).call('POST', `/api/feed/${id}/contact`, { result: 'yes' })).status).toBe(401);
    const yes = await b.call('POST', `/api/feed/${id}/contact`, { result: 'yes' });
    expect(yes.body.item).toMatchObject({ contacted: 1, myAnswer: 'yes' });
    expect((await b.call('POST', `/api/feed/${id}/contact`, { result: 'no' })).status).toBe(409);
    await c.call('POST', `/api/feed/${id}/contact`, { result: 'no' });
    // автор видит число, но не кто нажал
    const mine = await a.call('GET', `/api/installments/${id}`);
    expect(mine.body.installment.couldNotContact).toBe(1);
    expect(JSON.stringify(mine.body)).not.toContain('reader');
    const notes = (await a.call('GET', '/api/notifications')).body.items;
    expect(notes.map((n: { kind: string }) => n.kind)).toEqual(['check_seller']);
    // отмена ответа
    await c.call('DELETE', `/api/feed/${id}/contact`);
    expect((await a.call('GET', `/api/installments/${id}`)).body.installment.couldNotContact).toBe(0);
  });

  it('«Данные верны» и «Исправить» уведомляют нажавших; после 10 просьб — «под вопросом»', async () => {
    const { app, db } = await makeTestApp();
    const a = await user(app, 'author');
    const id = (await a.call('POST', '/api/installments', shopItem('Телефон'))).body.installment.id;
    const readers = [];
    for (let i = 0; i < 10; i++) readers.push(await user(app, `reader${i}`));
    for (const r of readers) await r.call('POST', `/api/feed/${id}/contact`, { result: 'no' });
    expect((await readers[0]!.call('GET', `/api/feed/${id}`)).body.item.doubtful).toBe(true);

    await a.call('POST', `/api/installments/${id}/seller/confirm`);
    expect((await readers[0]!.call('GET', `/api/feed/${id}`)).body.item.doubtful).toBe(false);
    const n = (await readers[3]!.call('GET', '/api/notifications')).body.items;
    expect(n[0].kind).toBe('author_confirmed');

    // снова просьбы, затем автор правит продавца
    const r2 = await user(app, 'late');
    await r2.call('POST', `/api/feed/${id}/contact`, { result: 'no' });
    await a.call('PATCH', `/api/installments/${id}`, { sellerType: 'shop', seller: { name: 'Другой магазин', phone: '89280000000' } });
    expect((await r2.call('GET', '/api/notifications')).body.items[0].kind).toBe('author_fixed');
    const h = await db.select().from(schema.sellerHistory);
    expect(h).toHaveLength(1);
  });

  it('неактивный автор + «под вопросом» → запись скрыта и ушла на проверку', async () => {
    const { app, ctx, clock } = await makeTestApp();
    const a = await user(app, 'author');
    const id = (await a.call('POST', '/api/installments', shopItem('Телефон'))).body.installment.id;
    for (let i = 0; i < 10; i++) await (await user(app, `reader${i}`)).call('POST', `/api/feed/${id}/contact`, { result: 'no' });
    expect(await runFeedMaintenance(ctx)).toBe(0); // автор активен
    clock.current = new Date(clock.current.getTime() + 70 * 24 * 3600 * 1000);
    expect(await runFeedMaintenance(ctx)).toBe(1);
    expect((await new Client(app).call('GET', '/api/feed')).body.items).toHaveLength(0);
  });

  it('жалобы: только фиксированные причины', async () => {
    const { app } = await makeTestApp();
    const a = await user(app, 'author');
    const id = (await a.call('POST', '/api/installments', shopItem('Телефон'))).body.installment.id;
    const b = await user(app, 'reader');
    expect((await b.call('POST', `/api/feed/${id}/complaint`, { reason: 'свободный текст' })).status).toBe(400);
    expect((await b.call('POST', `/api/feed/${id}/complaint`, { reason: 'spam' })).status).toBe(201);
  });

  it('удаление аккаунта: запись остаётся обезличенно', async () => {
    const { app } = await makeTestApp();
    const a = await user(app, 'author');
    await a.call('POST', '/api/installments', shopItem('Телефон'));
    expect((await a.call('DELETE', '/api/me', { password: 'password-1' })).status).toBe(200);
    const feed = await new Client(app).call('GET', '/api/feed');
    expect(feed.body.items).toHaveLength(1);
  });

  it('подсказки продавцов из справочника', async () => {
    const { app } = await makeTestApp();
    const a = await user(app, 'author');
    await a.call('POST', '/api/installments', shopItem('Телефон'));
    const r = await a.call('GET', `/api/sellers/suggest?q=${encodeURIComponent('техн')}&type=shop`);
    expect(r.body.items[0].name).toBe('Техномир');
  });
});
