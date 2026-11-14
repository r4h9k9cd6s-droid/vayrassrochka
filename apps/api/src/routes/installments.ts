import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  buildOriginalSchedule,
  CATEGORIES,
  ICONS,
  computeInstallment,
  guessProduct,
  type InstallmentParams,
  type JournalEvent,
} from '@vayrassrochka/shared';
import { requireUser, type User } from '../auth.js';
import { todayFor, type Ctx } from '../context.js';
import { schema } from '../db/index.js';
import { newId } from '../security.js';
import { findOrCreateSeller, hasSellerData } from '../sellers.js';

type InstRow = typeof schema.installments.$inferSelect;
type EventRow = typeof schema.installmentEvents.$inferSelect;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const catIds = CATEGORIES.map((c) => c.id) as [string, ...string[]];

const sellerInput = z.object({
  name: z.string().max(120).optional(),
  address: z.string().max(250).optional(),
  phone: z.string().max(40).optional(),
});

const baseFields = {
  title: z.string().trim().min(1).max(120),
  category: z.enum(catIds).optional(),
  icon: z.enum(ICONS).optional(),
  sellerType: z.enum(['shop', 'person', 'none']),
  seller: sellerInput.optional(),
  cost: z.number().int().min(1).max(100_000_000),
  downPayment: z.number().int().min(0),
  termMonths: z.number().int().min(1).max(120),
  monthlyPayment: z.number().int().min(1).nullable().optional(),
  purchaseDate: date,
  paymentDay: z.number().int().min(1).max(31),
  extraTerms: z.string().max(500).optional(),
  published: z.boolean().optional(),
  rightsConfirmed: z.boolean().optional(),
  /** Только при добавлении: сколько платежей по графику уже внесено (рассрочка уже идёт). */
  alreadyPaidCount: z.number().int().min(0).max(120).optional(),
};

export const toParams = (i: InstRow): InstallmentParams => ({
  cost: i.cost,
  downPayment: i.downPayment,
  termMonths: i.termMonths,
  ...(i.monthlyPayment ? { monthlyPayment: i.monthlyPayment } : {}),
  purchaseDate: i.purchaseDate,
  paymentDay: i.paymentDay,
});

export const toJournal = (rows: EventRow[]): JournalEvent[] =>
  rows
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((e) =>
      e.type === 'payment'
        ? { id: e.id, type: 'payment', date: e.date, amount: e.amount ?? 0, ...(e.voidedAt ? { voidedAt: e.voidedAt } : {}) }
        : { id: e.id, type: 'skip', date: e.date, ...(e.segmentId ? { segmentId: e.segmentId } : {}), ...(e.voidedAt ? { voidedAt: e.voidedAt } : {}) },
    );

export async function sellerView(ctx: Ctx, sellerId: string | null) {
  if (!sellerId) return null;
  const [s] = await ctx.db.select().from(schema.sellers).where(eq(schema.sellers.id, sellerId));
  return s ?? null;
}

function paramsError(p: InstallmentParams): string | null {
  try {
    computeInstallment(p, [], p.purchaseDate);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export function installmentRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

  async function own(u: User, id: string): Promise<InstRow | null> {
    const [row] = await db
      .select()
      .from(schema.installments)
      .where(and(eq(schema.installments.id, id), eq(schema.installments.userId, u.id)));
    return row ?? null;
  }

  async function view(u: User, inst: InstRow) {
    const events = await db.select().from(schema.installmentEvents).where(eq(schema.installmentEvents.installmentId, inst.id));
    const state = computeInstallment(toParams(inst), toJournal(events), todayFor(ctx, u.timezoneOffsetMin));
    const seller = await sellerView(ctx, inst.sellerId);
    const reports = await db.select().from(schema.contactReports).where(eq(schema.contactReports.installmentId, inst.id));
    return {
      installment: {
        id: inst.id,
        title: inst.title,
        category: inst.category,
        icon: inst.icon,
        sellerType: inst.sellerType,
        seller: seller && { id: seller.id, type: seller.type, name: seller.name, address: seller.address, phone: seller.phone },
        purchaseDate: inst.purchaseDate,
        paymentDay: inst.paymentDay,
        monthlyPayment: inst.monthlyPayment,
        extraTerms: inst.extraTerms,
        published: inst.published,
        feedState: inst.feedState,
        doubtful: inst.doubtful,
        // автор видит только число, не кто нажал
        couldNotContact: reports.filter((r) => r.result === 'no').length,
        contacted: reports.filter((r) => r.result === 'yes').length,
        createdAt: inst.createdAt,
      },
      state,
      events: events
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((e) => ({ id: e.id, type: e.type, date: e.date, amount: e.amount, segmentId: e.segmentId, voidedAt: e.voidedAt })),
    };
  }

  app.get('/api/installments', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const rows = await db.select().from(schema.installments).where(eq(schema.installments.userId, u.id));
    const items = [];
    for (const r of rows) items.push(await view(u, r));
    items.sort((a, b) => +new Date(b.installment.createdAt) - +new Date(a.installment.createdAt));
    return { items };
  });

  app.get('/api/installments/:id', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const inst = await own(u, (req.params as { id: string }).id);
    if (!inst) return reply.code(404).send({ error: 'not_found' });
    return view(u, inst);
  });

  function checkRules(
    b: { sellerType: string; seller?: z.infer<typeof sellerInput> | undefined; published?: boolean | undefined; rightsConfirmed?: boolean | undefined },
  ): string | null {
    if (b.sellerType !== 'none') {
      if (!b.seller || !hasSellerData({ type: b.sellerType as 'shop' | 'person', ...b.seller })) return 'seller_required';
    }
    if (b.published) {
      if (b.sellerType === 'none') return 'personal_not_publishable';
      if (!b.rightsConfirmed) return 'rights_not_confirmed';
    }
    return null;
  }

  app.post('/api/installments', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const body = z.object(baseFields).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const b = body.data;
    if (b.downPayment > b.cost) return reply.code(400).send({ error: 'down_payment_too_big' });
    const rule = checkRules(b);
    if (rule) return reply.code(400).send({ error: rule });
    const guess = guessProduct(b.title);
    const sellerId =
      b.sellerType === 'none' ? null : await findOrCreateSeller(ctx, { type: b.sellerType as 'shop' | 'person', ...(b.seller ?? {}) });
    const inst: InstRow = {
      id: newId(),
      userId: u.id,
      title: b.title,
      category: b.category ?? guess.category,
      icon: b.icon ?? guess.icon,
      sellerType: b.sellerType,
      sellerId,
      cost: b.cost,
      downPayment: b.downPayment,
      termMonths: b.termMonths,
      monthlyPayment: b.monthlyPayment ?? null,
      purchaseDate: b.purchaseDate,
      paymentDay: b.paymentDay,
      extraTerms: b.extraTerms ?? '',
      published: Boolean(b.published),
      feedState: 'visible',
      doubtRequests: 0,
      doubtful: false,
      createdAt: ctx.now(),
      updatedAt: ctx.now(),
      trashedAt: null,
    };
    const err = paramsError(toParams(inst));
    if (err) return reply.code(400).send({ error: 'invalid_input', message: err });
    const schedule = buildOriginalSchedule(toParams(inst));
    const already = b.alreadyPaidCount ?? 0;
    if (already > schedule.length) return reply.code(400).send({ error: 'already_paid_too_many' });
    await db.insert(schema.installments).values(inst);
    // «Рассрочка уже идёт»: прошлые платежи записываются по графику, каждый — в свой срок (но не позже сегодня).
    const today = todayFor(ctx, u.timezoneOffsetMin);
    for (let i = 0; i < already; i++) {
      const seg = schedule[i]!;
      await db.insert(schema.installmentEvents).values({
        id: newId(),
        installmentId: inst.id,
        type: 'payment',
        date: seg.dueDate < today ? seg.dueDate : today,
        amount: seg.amount,
        segmentId: null,
        createdAt: new Date(ctx.now().getTime() + i),
      });
    }
    return reply.code(201).send(await view(u, inst));
  });

  app.patch('/api/installments/:id', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const inst = await own(u, (req.params as { id: string }).id);
    if (!inst) return reply.code(404).send({ error: 'not_found' });
    const body = z.object(baseFields).partial().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const b = body.data;
    const merged = {
      sellerType: b.sellerType ?? inst.sellerType,
      seller: b.seller,
      published: b.published ?? inst.published,
      rightsConfirmed: b.rightsConfirmed ?? inst.published,
    };
    // Продавца перечитываем только если он менялся.
    const sellerChanged = b.sellerType !== undefined || b.seller !== undefined;
    if (sellerChanged) {
      const rule = checkRules(merged);
      if (rule) return reply.code(400).send({ error: rule });
    } else if (merged.published && inst.sellerType === 'none') {
      return reply.code(400).send({ error: 'personal_not_publishable' });
    } else if (b.published && !inst.published && !b.rightsConfirmed) {
      return reply.code(400).send({ error: 'rights_not_confirmed' });
    }
    const next: InstRow = {
      ...inst,
      title: b.title ?? inst.title,
      category: b.category ?? inst.category,
      icon: b.icon ?? inst.icon,
      cost: b.cost ?? inst.cost,
      downPayment: b.downPayment ?? inst.downPayment,
      termMonths: b.termMonths ?? inst.termMonths,
      monthlyPayment: b.monthlyPayment === undefined ? inst.monthlyPayment : b.monthlyPayment,
      purchaseDate: b.purchaseDate ?? inst.purchaseDate,
      paymentDay: b.paymentDay ?? inst.paymentDay,
      extraTerms: b.extraTerms ?? inst.extraTerms,
      published: merged.published,
      sellerType: merged.sellerType,
      updatedAt: ctx.now(),
    };
    const err = paramsError(toParams(next));
    if (err) return reply.code(400).send({ error: 'invalid_input', message: err });
    if (sellerChanged) {
      next.sellerId =
        next.sellerType === 'none'
          ? null
          : await findOrCreateSeller(ctx, { type: next.sellerType as 'shop' | 'person', ...(b.seller ?? {}) });
      if (next.sellerId !== inst.sellerId) {
        await db.insert(schema.sellerHistory).values({ id: newId(), installmentId: inst.id, oldSellerId: inst.sellerId, newSellerId: next.sellerId, by: `user:${u.id}` });
        await sellerFixed(ctx, inst.id, inst.title);
        next.doubtRequests = 0;
        next.doubtful = false;
      }
    }
    await db.update(schema.installments).set(next).where(eq(schema.installments.id, inst.id));
    return view(u, next);
  });

  app.delete('/api/installments/:id', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const inst = await own(u, (req.params as { id: string }).id);
    if (!inst) return reply.code(404).send({ error: 'not_found' });
    await db.delete(schema.installmentEvents).where(eq(schema.installmentEvents.installmentId, inst.id));
    await db.delete(schema.installments).where(eq(schema.installments.id, inst.id));
    return { ok: true };
  });

  // Отметить платёж / пропуск.
  app.post('/api/installments/:id/events', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const inst = await own(u, (req.params as { id: string }).id);
    if (!inst) return reply.code(404).send({ error: 'not_found' });
    const body = z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('payment'), date, amount: z.number().int().min(1).max(100_000_000) }),
        z.object({ type: z.literal('skip'), date, segmentId: z.string().max(20).optional() }),
      ])
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const existing = await db.select().from(schema.installmentEvents).where(eq(schema.installmentEvents.installmentId, inst.id));
    const id = newId();
    const candidate: JournalEvent =
      body.data.type === 'payment'
        ? { id, type: 'payment', date: body.data.date, amount: body.data.amount }
        : { id, type: 'skip', date: body.data.date, ...(body.data.segmentId ? { segmentId: body.data.segmentId } : {}) };
    const check = computeInstallment(toParams(inst), [...toJournal(existing), candidate], todayFor(ctx, u.timezoneOffsetMin));
    const rej = check.rejected.find((r) => r.eventId === id);
    if (rej) return reply.code(422).send({ error: rej.reason });
    await db.insert(schema.installmentEvents).values({
      id,
      installmentId: inst.id,
      type: candidate.type,
      date: candidate.date,
      amount: candidate.type === 'payment' ? candidate.amount : null,
      segmentId: candidate.type === 'skip' ? (candidate.segmentId ?? null) : null,
      createdAt: ctx.now(),
    });
    return reply.code(201).send(await view(u, inst));
  });

  // Отмена записи: она остаётся в истории, но не участвует в расчёте.
  app.post('/api/installments/:id/events/:eventId/void', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const { id, eventId } = req.params as { id: string; eventId: string };
    const inst = await own(u, id);
    if (!inst) return reply.code(404).send({ error: 'not_found' });
    const [ev] = await db
      .select()
      .from(schema.installmentEvents)
      .where(and(eq(schema.installmentEvents.id, eventId), eq(schema.installmentEvents.installmentId, inst.id)));
    if (!ev) return reply.code(404).send({ error: 'not_found' });
    if (!ev.voidedAt) {
      await db.update(schema.installmentEvents).set({ voidedAt: todayFor(ctx, u.timezoneOffsetMin) }).where(eq(schema.installmentEvents.id, ev.id));
    }
    return view(u, inst);
  });
}

/** Нажавшие «не удалось связаться» получают «Автор исправил данные». */
export async function sellerFixed(ctx: Ctx, installmentId: string, title: string): Promise<void> {
  const reports = await ctx.db
    .select()
    .from(schema.contactReports)
    .where(and(eq(schema.contactReports.installmentId, installmentId), inArray(schema.contactReports.result, ['no'])));
  for (const r of reports) {
    await ctx.db.insert(schema.notifications).values({ id: newId(), userId: r.userId, kind: 'author_fixed', payload: { installmentId, title } });
  }
  await ctx.db.delete(schema.contactReports).where(and(eq(schema.contactReports.installmentId, installmentId), eq(schema.contactReports.result, 'no')));
}
