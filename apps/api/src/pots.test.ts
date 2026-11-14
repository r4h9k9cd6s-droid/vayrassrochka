import { describe, expect, it } from 'vitest';
import { Client, makeTestApp } from './testing.js';

const pot = { name: 'Котёл с соседями', participants: 6, contribution: 3000, paymentDay: 5, myTurn: 2, startDate: '2026-01-01', alreadyPaid: 1 };

describe('котёл (сервер)', () => {
  it('создание, отметка взноса, запрет «заранее», отмена, получено', async () => {
    const { app } = await makeTestApp(); // сегодня 2026-03-10
    const c = new Client(app);
    await c.call('POST', '/api/auth/register', { login: 'user1', password: 'password-1' });
    const r = await c.call('POST', '/api/pots', pot);
    expect(r.status).toBe(201);
    // внесён 1-й; фев и март просрочены; апрель ближайший
    expect(r.body.state.overdueCount).toBe(2);
    expect(r.body.state.payableMonths).toEqual([2, 3, 4]);
    const id = r.body.pot.id;
    expect((await c.call('POST', `/api/pots/${id}/pay`, { month: 5 })).status).toBe(422);
    const p = await c.call('POST', `/api/pots/${id}/pay`, { month: 2 });
    expect(p.body.state.overdueCount).toBe(1);
    const u = await c.call('DELETE', `/api/pots/${id}/pay/2`);
    expect(u.body.state.overdueCount).toBe(2);
    const rec = await c.call('POST', `/api/pots/${id}/received`, { received: true });
    expect(rec.body.state.receive).toMatchObject({ month: 2, amount: 18000, received: true });
    expect((await c.call('POST', '/api/pots', { ...pot, myTurn: 9 })).status).toBe(400);
  });

  it('котёл другого человека недоступен; в ленту не попадает', async () => {
    const { app } = await makeTestApp();
    const a = new Client(app);
    await a.call('POST', '/api/auth/register', { login: 'user1', password: 'password-1' });
    const id = (await a.call('POST', '/api/pots', pot)).body.pot.id;
    const b = new Client(app);
    await b.call('POST', '/api/auth/register', { login: 'user2', password: 'password-1' });
    expect((await b.call('GET', `/api/pots/${id}`)).status).toBe(404);
    expect((await new Client(app).call('GET', '/api/feed')).body.items).toHaveLength(0);
  });
});
