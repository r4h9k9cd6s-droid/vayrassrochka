import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { canPayMonth, computePot, type PotParams } from '@vayrassrochka/shared';
import { requireUser, type User } from '../auth.js';
import { todayFor, type Ctx } from '../context.js';
import { schema } from '../db/index.js';
import { newId } from '../security.js';

type PotRow = typeof schema.pots.$inferSelect;

const fields = {
  name: z.string().trim().min(1).max(100),
  participants: z.number().int().min(2).max(120),
  contribution: z.number().int().min(1).max(10_000_000),
  paymentDay: z.number().int().min(1).max(31),
  myTurn: z.number().int().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  alreadyPaid: z.number().int().min(0).default(0),
};

export const potParams = (p: PotRow, months: number[]): PotParams => ({
  participants: p.participants,
  contribution: p.contribution,
  paymentDay: p.paymentDay,
  myTurn: p.myTurn,
  startDate: p.startDate,
  alreadyPaid: p.alreadyPaid,
  paidMonths: months,
  received: p.received,
});

export function potRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

  async function load(u: User, id: string) {
    const [pot] = await db.select().from(schema.pots).where(and(eq(schema.pots.id, id), eq(schema.pots.userId, u.id)));
    if (!pot) return null;
    const pays = await db.select().from(schema.potPayments).where(eq(schema.potPayments.potId, id));
    return { pot, months: pays.map((x) => x.month) };
  }
  const view = (u: User, pot: PotRow, months: number[]) => ({
    pot: { id: pot.id, name: pot.name, participants: pot.participants, contribution: pot.contribution, paymentDay: pot.paymentDay, myTurn: pot.myTurn, startDate: pot.startDate, alreadyPaid: pot.alreadyPaid, received: pot.received },
    state: computePot(potParams(pot, months), todayFor(ctx, u.timezoneOffsetMin)),
  });

  app.get('/api/pots', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const pots = await db.select().from(schema.pots).where(eq(schema.pots.userId, u.id));
    const items = [];
    for (const p of pots) {
      const pays = await db.select().from(schema.potPayments).where(eq(schema.potPayments.potId, p.id));
      items.push(view(u, p, pays.map((x) => x.month)));
    }
    return { items };
  });

  app.post('/api/pots', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const body = z.object(fields).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const row: PotRow = { id: newId(), userId: u.id, ...body.data, received: false, createdAt: ctx.now() };
    try {
      computePot(potParams(row, []), todayFor(ctx, u.timezoneOffsetMin));
    } catch (e) {
      return reply.code(400).send({ error: 'invalid_input', message: (e as Error).message });
    }
    await db.insert(schema.pots).values(row);
    return reply.code(201).send(view(u, row, []));
  });

  app.get('/api/pots/:id', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const l = await load(u, (req.params as { id: string }).id);
    if (!l) return reply.code(404).send({ error: 'not_found' });
    return view(u, l.pot, l.months);
  });

  app.delete('/api/pots/:id', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const l = await load(u, (req.params as { id: string }).id);
    if (!l) return reply.code(404).send({ error: 'not_found' });
    await db.delete(schema.potPayments).where(eq(schema.potPayments.potId, l.pot.id));
    await db.delete(schema.pots).where(eq(schema.pots.id, l.pot.id));
    return { ok: true };
  });

  // Отметить взнос: только просроченный или ближайший (заранее нельзя).
  app.post('/api/pots/:id/pay', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const l = await load(u, (req.params as { id: string }).id);
    if (!l) return reply.code(404).send({ error: 'not_found' });
    const body = z.object({ month: z.number().int().min(1), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const today = todayFor(ctx, u.timezoneOffsetMin);
    if (!canPayMonth(potParams(l.pot, l.months), today, body.data.month)) return reply.code(422).send({ error: 'month_not_payable' });
    await db.insert(schema.potPayments).values({ id: newId(), potId: l.pot.id, month: body.data.month, date: body.data.date ?? today, createdAt: ctx.now() });
    return view(u, l.pot, [...l.months, body.data.month]);
  });

  // Отмена отметки взноса (исправление ошибки).
  app.delete('/api/pots/:id/pay/:month', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const { id, month } = req.params as { id: string; month: string };
    const l = await load(u, id);
    if (!l) return reply.code(404).send({ error: 'not_found' });
    const m = Number(month);
    await db.delete(schema.potPayments).where(and(eq(schema.potPayments.potId, id), eq(schema.potPayments.month, m)));
    return view(u, l.pot, l.months.filter((x) => x !== m));
  });

  app.post('/api/pots/:id/received', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const l = await load(u, (req.params as { id: string }).id);
    if (!l) return reply.code(404).send({ error: 'not_found' });
    const body = z.object({ received: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    await db.update(schema.pots).set({ received: body.data.received }).where(eq(schema.pots.id, l.pot.id));
    return view(u, { ...l.pot, received: body.data.received }, l.months);
  });
}
