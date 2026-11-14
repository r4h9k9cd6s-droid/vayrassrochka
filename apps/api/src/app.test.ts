import { describe, expect, it } from 'vitest';
import { Client, makeTestApp } from './testing.js';

describe('аккаунт', () => {
  it('регистрация → код → вход → настройки → выход', async () => {
    const { app } = await makeTestApp();
    const c = new Client(app);
    expect((await c.call('GET', '/api/me')).status).toBe(401);

    const reg = await c.call('POST', '/api/auth/register', { login: 'Магомед', password: 'secret-pass-1' });
    expect(reg.status).toBe(201);
    expect(reg.body.backupCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(reg.body.backupCode).not.toMatch(/[01OIL]/);

    const me = await c.call('GET', '/api/me');
    expect(me.body.user.login).toBe('магомед');
    expect(me.body.user.backupCodeAcked).toBe(false);

    await c.call('POST', '/api/me/backup-code/ack');
    const st = await c.call('PATCH', '/api/me/settings', { theme: 'dark', hideAmounts: true });
    expect(st.body.user).toMatchObject({ theme: 'dark', hideAmounts: true, backupCodeAcked: true });
    expect((await c.call('PATCH', '/api/me/settings', { theme: 'pink' })).status).toBe(400);

    await c.call('POST', '/api/auth/logout');
    expect((await c.call('GET', '/api/me')).status).toBe(401);

    const c2 = new Client(app);
    expect((await c2.call('POST', '/api/auth/login', { login: 'магомед', password: 'bad-password' })).status).toBe(401);
    expect((await c2.call('POST', '/api/auth/login', { login: 'МАГОМЕД', password: 'secret-pass-1' })).status).toBe(200);
    expect((await c2.call('GET', '/api/me')).status).toBe(200);
  });

  it('логин занят, пароль короткий', async () => {
    const { app } = await makeTestApp();
    const c = new Client(app);
    expect((await c.call('POST', '/api/auth/register', { login: 'ali', password: 'short' })).status).toBe(400);
    await c.call('POST', '/api/auth/register', { login: 'ali', password: 'longenough1' });
    expect((await new Client(app).call('POST', '/api/auth/register', { login: 'ALI', password: 'longenough1' })).status).toBe(409);
  });

  it('сброс пароля по резервному коду выдаёт новый код, старый не работает', async () => {
    const { app } = await makeTestApp();
    const c = new Client(app);
    const code1 = (await c.call('POST', '/api/auth/register', { login: 'user1', password: 'old-password' })).body.backupCode;
    const c2 = new Client(app);
    const lower = code1.toLowerCase().replace(/-/g, ' ');
    const r = await c2.call('POST', '/api/auth/reset', { login: 'user1', backupCode: lower, newPassword: 'new-password' });
    expect(r.status).toBe(200);
    const code2 = r.body.backupCode;
    expect(code2).not.toBe(code1);
    expect((await c2.call('POST', '/api/auth/reset', { login: 'user1', backupCode: code1, newPassword: 'another-pass' })).status).toBe(401);
    expect((await new Client(app).call('POST', '/api/auth/login', { login: 'user1', password: 'new-password' })).status).toBe(200);
    expect((await new Client(app).call('POST', '/api/auth/login', { login: 'user1', password: 'old-password' })).status).toBe(401);
    // старые сессии закрыты
    expect((await c.call('GET', '/api/me')).status).toBe(401);
  });

  it('новый код в настройках только после пароля', async () => {
    const { app } = await makeTestApp();
    const c = new Client(app);
    const code1 = (await c.call('POST', '/api/auth/register', { login: 'user2', password: 'password-1' })).body.backupCode;
    expect((await c.call('POST', '/api/me/backup-code/renew', { password: 'wrong-one' })).status).toBe(401);
    const code2 = (await c.call('POST', '/api/me/backup-code/renew', { password: 'password-1' })).body.backupCode;
    expect(code2).not.toBe(code1);
    const r = await new Client(app).call('POST', '/api/auth/reset', { login: 'user2', backupCode: code1, newPassword: 'password-2' });
    expect(r.status).toBe(401);
  });

  it('смена пароля и ограничение попыток входа', async () => {
    const { app } = await makeTestApp();
    const c = new Client(app);
    await c.call('POST', '/api/auth/register', { login: 'user3', password: 'password-1' });
    expect((await c.call('POST', '/api/me/password', { oldPassword: 'nope-nope', newPassword: 'password-2' })).status).toBe(401);
    expect((await c.call('POST', '/api/me/password', { oldPassword: 'password-1', newPassword: 'password-2' })).status).toBe(200);
    const x = new Client(app);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await x.call('POST', '/api/auth/login', { login: 'user3', password: 'wrong-pass' })).status;
    expect(last).toBe(429);
  });

  it('в базе нет пароля и кода в открытом виде', async () => {
    const { app, db } = await makeTestApp();
    const c = new Client(app);
    const code = (await c.call('POST', '/api/auth/register', { login: 'user4', password: 'password-1' })).body.backupCode as string;
    const { users } = (await import('./db/schema.js'));
    const rows = await db.select().from(users);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain('password-1');
    expect(dump).not.toContain(code.replace(/-/g, ''));
    expect(rows[0]!.passwordHash.startsWith('$argon2')).toBe(true);
  });
});
