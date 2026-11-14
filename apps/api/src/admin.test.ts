import { generateSecret } from 'otplib';
import { describe, expect, it } from 'vitest';
import { schema } from './db/index.js';
import { purgeTrash, totpNow } from './routes/admin.js';
import { generateBackupCode, hashBackupCode, hashSecret, newId } from './security.js';
import { Client, makeTestApp } from './testing.js';

const shopItem = { title: 'Телефон', cost: 60000, downPayment: 0, termMonths: 6, purchaseDate: '2026-01-10', paymentDay: 15, published: true, rightsConfirmed: true, sellerType: 'shop', seller: { name: 'Техномир', phone: '89281112233' } };

async function setup() {
  const t = await makeTestApp();
  const secret = generateSecret();
  const spare = generateBackupCode();
  await t.db.insert(schema.admins).values({ id: newId(), login: 'owner', passwordHash: await hashSecret('owner-password-1'), role: 'owner', totpSecret: secret, backupCodes: [await hashBackupCode(spare)] });
  const author = new Client(t.app);
  await author.call('POST', '/api/auth/register', { login: 'author', password: 'password-1' });
  const id = (await author.call('POST', '/api/installments', shopItem)).body.installment.id as string;
  const admin = new Client(t.app);
  return { ...t, secret, spare, author, id, admin };
}
const login = (c: Client, secret: string, extra = {}) =>
  c.call('POST', '/api/admin/login', { login: 'owner', password: 'owner-password-1', code: totpNow(secret), ...extra });

describe('панель владельца', () => {
  it('вход только с кодом из приложения; обычный пользователь не получает доступ', async () => {
    const { admin, author, secret } = await setup();
    expect((await admin.call('GET', '/api/admin/overview')).status).toBe(401);
    expect((await author.call('GET', '/api/admin/overview')).status).toBe(401);
    expect((await admin.call('POST', '/api/admin/login', { login: 'owner', password: 'owner-password-1' })).body.error).toBe('code_required');
    expect((await admin.call('POST', '/api/admin/login', { login: 'owner', password: 'owner-password-1', code: '000000' })).status).toBe(401);
    expect((await admin.call('POST', '/api/admin/login', { login: 'owner', password: 'wrong', code: totpNow(secret) })).status).toBe(401);
    expect((await login(admin, secret)).status).toBe(200);
    expect((await admin.call('GET', '/api/admin/overview')).body.users).toBe(1);
  });

  it('резервный код владельца работает один раз', async () => {
    const { admin, spare } = await setup();
    const body = { login: 'owner', password: 'owner-password-1', code: spare };
    expect((await admin.call('POST', '/api/admin/login', body)).status).toBe(200);
    expect((await new Client(admin['app']).call('POST', '/api/admin/login', body)).status).toBe(401);
  });

  it('жалоба → скрыть из ленты; всё в журнале; публичные данные без автора', async () => {
    const { admin, author, secret, id, app } = await setup();
    const reader = new Client(app);
    await reader.call('POST', '/api/auth/register', { login: 'reader', password: 'password-1' });
    await reader.call('POST', `/api/feed/${id}/complaint`, { reason: 'spam' });
    await login(admin, secret);
    const list = (await admin.call('GET', '/api/admin/complaints')).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ count: 1, reasons: { spam: 1 } });
    const dump = JSON.stringify(list);
    expect(dump).not.toContain('author');
    expect(dump).not.toContain('userId');
    expect((await admin.call('GET', '/api/admin/overview')).body.toDecide.complaints).toBe(1);

    await admin.call('POST', `/api/admin/complaints/${id}/resolve`, { action: 'hide', note: 'реклама' });
    expect((await new Client(app).call('GET', '/api/feed')).body.items).toHaveLength(0);
    const log = (await admin.call('GET', '/api/admin/audit')).body.items;
    expect(log[0]).toMatchObject({ action: 'complaint_hide', targetId: id, before: { feedState: 'visible' }, after: { feedState: 'hidden' } });
    // у автора запись осталась личной
    expect((await author.call('GET', `/api/installments/${id}`)).status).toBe(200);
  });

  it('на проверке: исправить продавца и вернуть в ленту', async () => {
    const { admin, secret, id, db, app } = await setup();
    await db.update(schema.installments).set({ feedState: 'review', doubtful: true });
    await login(admin, secret);
    expect((await admin.call('GET', '/api/admin/review')).body.items).toHaveLength(1);
    await admin.call('POST', `/api/admin/installments/${id}/seller`, { seller: { type: 'shop', name: 'Новый магазин', phone: '89280001122' } });
    const feed = (await new Client(app).call('GET', '/api/feed')).body.items;
    expect(feed[0]).toMatchObject({ doubtful: false, seller: { name: 'Новый магазин' } });
    expect((await admin.call('GET', '/api/admin/review')).body.items).toHaveLength(0);
  });

  it('продавцы: правка, объединение дублей; корзина с восстановлением и очисткой через 30 дней', async () => {
    const { admin, author, secret, id, ctx, clock, app } = await setup();
    const id2 = (await author.call('POST', '/api/installments', { ...shopItem, seller: { name: 'Техно-Мир', phone: '' } })).body.installment.id;
    await login(admin, secret);
    const sellers = (await admin.call('GET', '/api/admin/sellers')).body.items;
    expect(sellers).toHaveLength(2);
    const [a, b] = sellers;
    const merged = await admin.call('POST', '/api/admin/sellers/merge', { fromId: b.id, toId: a.id });
    expect(merged.body.moved).toBe(1);
    expect((await admin.call('GET', '/api/admin/sellers')).body.items).toHaveLength(1);
    await admin.call('PATCH', `/api/admin/sellers/${a.id}`, { name: 'Техномир Плюс' });
    expect((await new Client(app).call('GET', '/api/feed')).body.items[0].seller.name).toBe('Техномир Плюс');
    await admin.call('PATCH', `/api/admin/sellers/${a.id}`, { hidden: true });
    expect((await new Client(app).call('GET', '/api/feed')).body.items).toHaveLength(0);
    await admin.call('PATCH', `/api/admin/sellers/${a.id}`, { hidden: false });

    await admin.call('POST', `/api/admin/installments/${id2}/state`, { state: 'trash' });
    expect((await admin.call('GET', '/api/admin/trash')).body.items).toHaveLength(1);
    await admin.call('POST', `/api/admin/installments/${id2}/state`, { state: 'visible' });
    expect((await admin.call('GET', '/api/admin/trash')).body.items).toHaveLength(0);
    await admin.call('POST', `/api/admin/installments/${id}/state`, { state: 'trash' });
    clock.current = new Date(clock.current.getTime() + 31 * 86400_000);
    expect(await purgeTrash(ctx)).toBe(1);
  });

  it('отзывы о приложении', async () => {
    const { admin, author, secret } = await setup();
    await author.call('POST', '/api/feedback', { text: 'Добавьте тёмную тему' });
    await login(admin, secret);
    const [f] = (await admin.call('GET', '/api/admin/feedback')).body.items;
    expect(f.text).toBe('Добавьте тёмную тему');
    expect(JSON.stringify(f)).not.toContain('userId');
    await admin.call('PATCH', `/api/admin/feedback/${f.id}`, { status: 'planned' });
    expect((await admin.call('GET', '/api/admin/feedback')).body.items[0].status).toBe('planned');
  });

  it('«доверять устройству»: следующий вход без кода, на другом устройстве — с кодом', async () => {
    const { admin, secret, app } = await setup();
    await login(admin, secret, { trustDevice: true });
    await admin.call('POST', '/api/admin/logout');
    expect((await admin.call('GET', '/api/admin/overview')).status).toBe(401);
    const again = await admin.call('POST', '/api/admin/login', { login: 'owner', password: 'owner-password-1' });
    expect(again.status).toBe(200);
    const other = new Client(app);
    expect((await other.call('POST', '/api/admin/login', { login: 'owner', password: 'owner-password-1' })).status).toBe(401);
  });
});
