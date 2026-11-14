import { and, count, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CATEGORIES } from '@vayrassrochka/shared';
import { requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import { schema } from '../db/index.js';
import { rateAllow } from '../rate.js';
import { newId, normalizeName } from '../security.js';

type InstRow = typeof schema.installments.$inferSelect;
type SellerRow = typeof schema.sellers.$inferSelect;

const DOUBT_LIMIT = 10;
const INACTIVE_MS = 61 * 24 * 3600 * 1000; // «больше 2 месяцев»
const ARCHIVE_MS = 365 * 24 * 3600 * 1000;
const DAILY_CONTACT_LIMIT = 20;

export const defaultMonthly = (i: InstRow) => i.monthlyPayment ?? Math.floor((i.cost - i.downPayment) / i.termMonths);

/** Публичный вид записи: без автора, платежей и личных финансов — только исходные условия. */
export async function publicItem(ctx: Ctx, i: InstRow, seller: SellerRow | null, viewerId: string | null) {
  const [yes] = await ctx.db
    .select({ n: count() })
    .from(schema.contactReports)
    .where(and(eq(schema.contactReports.installmentId, i.id), eq(schema.contactReports.result, 'yes')));
  const mine = viewerId !== null && i.userId === viewerId;
  let myAnswer: string | null = null;
  if (viewerId) {
    const [r] = await ctx.db
      .select()
      .from(schema.contactReports)
      .where(and(eq(schema.contactReports.installmentId, i.id), eq(schema.contactReports.userId, viewerId)));
    myAnswer = r?.result ?? null;
  }
  // Гость не видит данные частных лиц; магазины видны всем.
  const personHidden = seller?.type === 'person' && viewerId === null;
  return {
    id: i.id,
    title: i.title,
    icon: i.icon,
    category: i.category,
    cost: i.cost,
    downPayment: i.downPayment,
    termMonths: i.termMonths,
    monthlyPayment: defaultMonthly(i),
    purchaseDate: i.purchaseDate,
    extraTerms: i.extraTerms,
    createdAt: i.createdAt,
    doubtful: i.doubtful,
    contacted: yes?.n ?? 0,
    mine,
    myAnswer,
    seller: seller
      ? personHidden
        ? { type: 'person', hidden: true }
        : { type: seller.type, name: seller.name, address: seller.address, phone: seller.phone }
      : null,
  };
}

async function visibleRows(ctx: Ctx, includeArchive: boolean) {
  const rows = await ctx.db
    .select({ i: schema.installments, s: schema.sellers })
    .from(schema.installments)
    .innerJoin(schema.sellers, eq(schema.sellers.id, schema.installments.sellerId))
    .where(and(eq(schema.installments.published, true), eq(schema.installments.feedState, 'visible'), eq(schema.sellers.hidden, false)));
  const cutoff = ctx.now().getTime() - ARCHIVE_MS;
  return includeArchive ? rows : rows.filter((r) => r.i.createdAt.getTime() >= cutoff);
}

export function feedRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  const catIds = CATEGORIES.map((c) => c.id) as [string, ...string[]];

  app.get('/api/feed', async (req) => {
    const q = z
      .object({
        category: z.enum(catIds).optional(),
        q: z.string().max(100).optional(),
        maxMonthly: z.coerce.number().int().min(0).optional(),
        term: z.enum(['upto6', '6to12', 'over12']).optional(),
        sort: z.enum(['new', 'monthly', 'price']).default('new'),
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        archive: z.coerce.boolean().optional(),
      })
      .parse(req.query);
    const needle = q.q ? normalizeName(q.q) : '';
    let rows = await visibleRows(ctx, Boolean(q.archive));
    rows = rows.filter(({ i, s }) => {
      if (q.category && i.category !== q.category) return false;
      if (q.maxMonthly !== undefined && defaultMonthly(i) > q.maxMonthly) return false;
      if (q.term === 'upto6' && i.termMonths > 6) return false;
      if (q.term === '6to12' && (i.termMonths < 6 || i.termMonths > 12)) return false;
      if (q.term === 'over12' && i.termMonths <= 12) return false;
      // Поиск по товару и названию продавца (данные частных лиц гостям не раскрываются поиском).
      if (needle && !normalizeName(i.title).includes(needle) && !(s.type === 'shop' && s.nameNorm.includes(needle))) return false;
      return true;
    });
    rows.sort((a, b) =>
      q.sort === 'monthly'
        ? defaultMonthly(a.i) - defaultMonthly(b.i)
        : q.sort === 'price'
          ? a.i.cost - b.i.cost
          : b.i.createdAt.getTime() - a.i.createdAt.getTime(),
    );
    const page = rows.slice(q.offset, q.offset + q.limit);
    const viewer = req.user?.id ?? null;
    const items = [];
    for (const r of page) items.push(await publicItem(ctx, r.i, r.s, viewer));
    return { items, total: rows.length, serverTime: ctx.now().toISOString() };
  });

  // «N новые покупки» с прошлого посещения; клиент опрашивает периодически.
  app.get('/api/feed/new-count', async (req) => {
    const { since } = z.object({ since: z.string().datetime() }).parse(req.query);
    const viewer = req.user?.id ?? null;
    const rows = await visibleRows(ctx, false);
    const n = rows.filter((r) => r.i.createdAt > new Date(since) && r.i.userId !== viewer).length;
    return { count: n, serverTime: ctx.now().toISOString() };
  });

  app.get('/api/feed/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = (await visibleRows(ctx, true)).find((r) => r.i.id === id);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return { item: await publicItem(ctx, row.i, row.s, req.user?.id ?? null) };
  });

  // «Удалось связаться с продавцом?»
  app.post('/api/feed/:id/contact', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const { id } = req.params as { id: string };
    const body = z.object({ result: z.enum(['yes', 'no']) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const row = (await visibleRows(ctx, true)).find((r) => r.i.id === id);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (row.i.userId === u.id) return reply.code(403).send({ error: 'own_record' });
    const [prev] = await db
      .select()
      .from(schema.contactReports)
      .where(and(eq(schema.contactReports.installmentId, id), eq(schema.contactReports.userId, u.id)));
    if (prev) return reply.code(409).send({ error: 'already_answered' });
    if (!(await rateAllow(ctx, `contact:${u.id}`, DAILY_CONTACT_LIMIT, 86400))) return reply.code(429).send({ error: 'too_many_requests' });
    await db.insert(schema.contactReports).values({ id: newId(), installmentId: id, userId: u.id, result: body.data.result, createdAt: ctx.now() });
    if (body.data.result === 'no') await onDoubt(ctx, row.i, +1);
    return reply.code(201).send({ item: await publicItem(ctx, row.i, row.s, u.id) });
  });

  // Отменить свой ответ.
  app.delete('/api/feed/:id/contact', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const { id } = req.params as { id: string };
    const row = (await visibleRows(ctx, true)).find((r) => r.i.id === id);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    const [prev] = await db
      .select()
      .from(schema.contactReports)
      .where(and(eq(schema.contactReports.installmentId, id), eq(schema.contactReports.userId, u.id)));
    if (prev) {
      await db.delete(schema.contactReports).where(eq(schema.contactReports.id, prev.id));
      if (prev.result === 'no') await onDoubt(ctx, row.i, -1);
    }
    return { item: await publicItem(ctx, row.i, row.s, u.id) };
  });

  // Автор: «Данные верны».
  app.post('/api/installments/:id/seller/confirm', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const { id } = req.params as { id: string };
    const [inst] = await db.select().from(schema.installments).where(and(eq(schema.installments.id, id), eq(schema.installments.userId, u.id)));
    if (!inst) return reply.code(404).send({ error: 'not_found' });
    const reports = await db
      .select()
      .from(schema.contactReports)
      .where(and(eq(schema.contactReports.installmentId, id), eq(schema.contactReports.result, 'no')));
    for (const r of reports) {
      await db.insert(schema.notifications).values({ id: newId(), userId: r.userId, kind: 'author_confirmed', payload: { installmentId: id, title: inst.title } });
    }
    await db.delete(schema.contactReports).where(and(eq(schema.contactReports.installmentId, id), eq(schema.contactReports.result, 'no')));
    await db.update(schema.installments).set({ doubtRequests: 0, doubtful: false }).where(eq(schema.installments.id, id));
    await db.delete(schema.notifications).where(and(eq(schema.notifications.userId, u.id), eq(schema.notifications.kind, 'check_seller')));
    return { ok: true };
  });

  app.post('/api/feed/:id/complaint', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const { id } = req.params as { id: string };
    const body = z.object({ reason: z.enum(['personal_data', 'wrong_seller', 'spam', 'other']) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const row = (await visibleRows(ctx, true)).find((r) => r.i.id === id);
    if (!row) return reply.code(404).send({ error: 'not_found' });
    if (!(await rateAllow(ctx, `complaint:${u.id}`, 20, 86400))) return reply.code(429).send({ error: 'too_many_requests' });
    const [dup] = await db
      .select()
      .from(schema.complaints)
      .where(and(eq(schema.complaints.installmentId, id), eq(schema.complaints.userId, u.id), eq(schema.complaints.status, 'open')));
    if (!dup) await db.insert(schema.complaints).values({ id: newId(), installmentId: id, userId: u.id, reason: body.data.reason, createdAt: ctx.now() });
    return reply.code(201).send({ ok: true });
  });

  app.get('/api/notifications', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const rows = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, u.id));
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return { items: rows.slice(0, 50) };
  });

  app.post('/api/notifications/read', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const rows = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, u.id));
    const ids = rows.filter((r) => !r.readAt).map((r) => r.id);
    if (ids.length) await db.update(schema.notifications).set({ readAt: ctx.now() }).where(inArray(schema.notifications.id, ids));
    return { ok: true };
  });

  // Справочник: подсказки продавцов при вводе названия.
  app.get('/api/sellers/suggest', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const q = z.object({ q: z.string().max(100), type: z.enum(['shop', 'person']).default('shop') }).parse(req.query);
    const needle = normalizeName(q.q);
    if (needle.length < 2) return { items: [] };
    const rows = await db.select().from(schema.sellers).where(and(eq(schema.sellers.type, q.type), eq(schema.sellers.hidden, false)));
    return {
      items: rows
        .filter((s) => s.nameNorm.includes(needle))
        .slice(0, 6)
        .map((s) => ({ id: s.id, name: s.name, address: s.address, phone: s.phone })),
    };
  });
}

async function onDoubt(ctx: Ctx, inst: InstRow, delta: 1 | -1): Promise<void> {
  const next = Math.max(0, inst.doubtRequests + delta);
  await ctx.db
    .update(schema.installments)
    .set({ doubtRequests: next, doubtful: next >= DOUBT_LIMIT })
    .where(eq(schema.installments.id, inst.id));
  inst.doubtRequests = next;
  inst.doubtful = next >= DOUBT_LIMIT;
  if (delta === 1 && inst.userId) {
    const [existing] = await ctx.db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, inst.userId), eq(schema.notifications.kind, 'check_seller')));
    const payload = { installmentId: inst.id, title: inst.title };
    if (!existing || (existing.payload as { installmentId?: string }).installmentId !== inst.id) {
      await ctx.db.insert(schema.notifications).values({ id: newId(), userId: inst.userId, kind: 'check_seller', payload });
    }
  }
}

/**
 * Периодическая уборка: если у записи пометка «под вопросом» и автор не заходил больше 2 месяцев —
 * запись скрывается из ленты и уходит владельцу на проверку.
 */
export async function runFeedMaintenance(ctx: Ctx): Promise<number> {
  const cutoff = new Date(ctx.now().getTime() - INACTIVE_MS);
  const rows = await ctx.db
    .select({ i: schema.installments, u: schema.users })
    .from(schema.installments)
    .innerJoin(schema.users, eq(schema.users.id, schema.installments.userId))
    .where(and(eq(schema.installments.doubtful, true), eq(schema.installments.feedState, 'visible'), eq(schema.installments.published, true)));
  const stale = rows.filter((r) => r.u.lastSeenAt < cutoff);
  for (const r of stale) await ctx.db.update(schema.installments).set({ feedState: 'review' }).where(eq(schema.installments.id, r.i.id));
  return stale.length;
}

