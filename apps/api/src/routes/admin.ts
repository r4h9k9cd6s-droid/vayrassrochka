import { and, desc, eq, lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { generateSync, verifySync } from 'otplib';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { schema } from '../db/index.js';
import { rateAllow } from '../rate.js';
import {
  newId,
  newToken,
  normalizeLogin,
  sha256,
  verifyBackupCode,
  verifySecret,
} from '../security.js';
import { findOrCreateSeller } from '../sellers.js';
import { sellerFixed } from './installments.js';

type Admin = typeof schema.admins.$inferSelect;
const ASID = 'asid';
const TRUST = 'atrust';
const SESSION_MS = 12 * 3600 * 1000;
const TRUST_MS = 30 * 24 * 3600 * 1000;
const TRASH_MS = 30 * 24 * 3600 * 1000;

declare module 'fastify' {
  interface FastifyRequest {
    admin: Admin | null;
  }
}

export const totpValid = (secret: string, token: string) => {
  try {
    return verifySync({ secret, token, epochTolerance: 30 }).valid;
  } catch {
    return false;
  }
};
export const totpNow = (secret: string) => generateSync({ secret });

/** Запись в журнал: кто, когда, что было и что стало. */
async function audit(ctx: Ctx, admin: Admin, action: string, targetType: string, targetId: string, before: unknown, after: unknown) {
  await ctx.db.insert(schema.auditLog).values({
    id: newId(), adminId: admin.id, action, targetType, targetId,
    before: (before ?? null) as never, after: (after ?? null) as never, createdAt: ctx.now(),
  });
}

/** Публичные данные записи для модератора: без автора и платежей. */
async function recordCard(ctx: Ctx, i: typeof schema.installments.$inferSelect) {
  const [s] = i.sellerId ? await ctx.db.select().from(schema.sellers).where(eq(schema.sellers.id, i.sellerId)) : [];
  return {
    id: i.id, title: i.title, category: i.category, cost: i.cost, downPayment: i.downPayment, termMonths: i.termMonths,
    purchaseDate: i.purchaseDate, extraTerms: i.extraTerms, feedState: i.feedState, doubtful: i.doubtful, createdAt: i.createdAt,
    seller: s ? { id: s.id, type: s.type, name: s.name, address: s.address, phone: s.phone, hidden: s.hidden } : null,
  };
}

export function adminRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;
  app.decorateRequest('admin', null);

  app.addHook('preHandler', async (req: FastifyRequest) => {
    const token = req.cookies[ASID];
    if (!token) return;
    const [row] = await db
      .select({ a: schema.admins, exp: schema.adminSessions.expiresAt })
      .from(schema.adminSessions)
      .innerJoin(schema.admins, eq(schema.admins.id, schema.adminSessions.adminId))
      .where(eq(schema.adminSessions.id, sha256(token)));
    if (row && row.exp > ctx.now()) req.admin = row.a;
  });

  const need = (req: FastifyRequest, reply: FastifyReply): Admin | null => {
    if (!req.admin) {
      void reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return req.admin;
  };

  // Вход: логин + пароль + код из приложения-аутентификатора (или резервный код владельца).
  app.post('/api/admin/login', async (req, reply) => {
    const body = z
      .object({ login: z.string().transform(normalizeLogin), password: z.string().max(200), code: z.string().max(40).default(''), trustDevice: z.boolean().optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!(await rateAllow(ctx, `admin-login:${req.ip}:${body.data.login}`, 8, 900))) return reply.code(429).send({ error: 'too_many_requests' });
    const [a] = await db.select().from(schema.admins).where(eq(schema.admins.login, body.data.login));
    if (!a || !(await verifySecret(a.passwordHash, body.data.password))) return reply.code(401).send({ error: 'wrong_credentials' });

    // Доверенное устройство (30 дней) освобождает от кода; иначе код обязателен.
    let trusted = false;
    const trustToken = req.cookies[TRUST];
    if (trustToken) {
      const [t] = await db.select().from(schema.adminTrustedDevices).where(eq(schema.adminTrustedDevices.id, sha256(trustToken)));
      trusted = Boolean(t && t.adminId === a.id && t.expiresAt > ctx.now());
    }
    if (!trusted) {
      const code = body.data.code.trim();
      let ok = false;
      if (/^\d{6}$/.test(code)) ok = totpValid(a.totpSecret, code);
      else if (code) {
        const codes = a.backupCodes as string[];
        for (let i = 0; i < codes.length && !ok; i++) {
          if (await verifyBackupCode(codes[i]!, code)) {
            ok = true;
            await db.update(schema.admins).set({ backupCodes: codes.filter((_, j) => j !== i) }).where(eq(schema.admins.id, a.id));
          }
        }
      }
      if (!ok) return reply.code(401).send({ error: code ? 'wrong_code' : 'code_required' });
      if (body.data.trustDevice) {
        const tt = newToken();
        await db.insert(schema.adminTrustedDevices).values({ id: sha256(tt), adminId: a.id, expiresAt: new Date(ctx.now().getTime() + TRUST_MS) });
        reply.setCookie(TRUST, tt, { httpOnly: true, sameSite: 'strict', secure: ctx.config.secureCookies, path: '/api/admin', maxAge: TRUST_MS / 1000 });
      }
    }
    const token = newToken();
    await db.insert(schema.adminSessions).values({ id: sha256(token), adminId: a.id, expiresAt: new Date(ctx.now().getTime() + SESSION_MS) });
    reply.setCookie(ASID, token, { httpOnly: true, sameSite: 'strict', secure: ctx.config.secureCookies, path: '/', maxAge: SESSION_MS / 1000 });
    return { admin: { login: a.login, role: a.role } };
  });

  app.post('/api/admin/logout', async (req, reply) => {
    const t = req.cookies[ASID];
    if (t) await db.delete(schema.adminSessions).where(eq(schema.adminSessions.id, sha256(t)));
    reply.clearCookie(ASID, { path: '/' });
    return { ok: true };
  });

  app.get('/api/admin/me', async (req, reply) => {
    const a = need(req, reply);
    if (!a) return;
    return { admin: { login: a.login, role: a.role } };
  });

  app.get('/api/admin/overview', async (req, reply) => {
    const a = need(req, reply);
    if (!a) return;
    const users = await db.select({ id: schema.users.id }).from(schema.users);
    const inst = await db.select().from(schema.installments);
    const compl = await db.select().from(schema.complaints).where(eq(schema.complaints.status, 'open'));
    const fb = await db.select().from(schema.feedback).where(eq(schema.feedback.status, 'new'));
    return {
      users: users.length,
      published: inst.filter((i) => i.published && i.feedState === 'visible').length,
      toDecide: {
        complaints: compl.length,
        review: inst.filter((i) => i.feedState === 'review').length,
        feedback: fb.length,
      },
    };
  });

  // Жалобы
  app.get('/api/admin/complaints', async (req, reply) => {
    const a = need(req, reply);
    if (!a) return;
    const rows = await db.select().from(schema.complaints).where(eq(schema.complaints.status, 'open'));
    const byRecord = new Map<string, typeof rows>();
    for (const r of rows) byRecord.set(r.installmentId, [...(byRecord.get(r.installmentId) ?? []), r]);
    const items = [];
    for (const [id, list] of byRecord) {
      const [i] = await db.select().from(schema.installments).where(eq(schema.installments.id, id));
      if (!i) continue;
      const reasons: Record<string, number> = {};
      for (const c of list) reasons[c.reason] = (reasons[c.reason] ?? 0) + 1;
      items.push({ installmentId: id, count: list.length, reasons, record: await recordCard(ctx, i) });
    }
    items.sort((x, y) => y.count - x.count);
    return { items };
  });

  app.post('/api/admin/complaints/:installmentId/resolve', async (req, reply) => {
    const a = need(req, reply);
    if (!a) return;
    const { installmentId } = req.params as { installmentId: string };
    const body = z.object({ action: z.enum(['keep', 'hide', 'trash']), note: z.string().max(500).default('') }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const [i] = await db.select().from(schema.installments).where(eq(schema.installments.id, installmentId));
    if (!i) return reply.code(404).send({ error: 'not_found' });
    const before = { feedState: i.feedState };
    if (body.data.action !== 'keep') {
      const state = body.data.action === 'hide' ? 'hidden' : 'trash';
      await db.update(schema.installments).set({ feedState: state, trashedAt: state === 'trash' ? ctx.now() : null }).where(eq(schema.installments.id, i.id));
    }
    await db
      .update(schema.complaints)
      .set({ status: 'closed', note: body.data.note, resolvedAt: ctx.now() })
      .where(and(eq(schema.complaints.installmentId, i.id), eq(schema.complaints.status, 'open')));
    await audit(ctx, a, `complaint_${body.data.action}`, 'installment', i.id, before, { feedState: body.data.action === 'keep' ? i.feedState : body.data.action === 'hide' ? 'hidden' : 'trash', note: body.data.note });
    return { ok: true };
  });

  // На проверке (скрытые записи неактивных авторов)
  app.get('/api/admin/review', async (req, reply) => {
    const a = need(req, reply);
    if (!a) return;
    const rows = await db.select().from(schema.installments).where(eq(schema.installments.feedState, 'review'));
    return { items: await Promise.all(rows.map((r) => recordCard(ctx, r))) };
  });

  // Изменить продавца записи и/или вернуть в ленту
  app.post('/api/admin/installments/:id/seller', async (req, reply) => {
    const a = need(req, reply);
    if (!a) return;
    const { id } = req.params as { id: string };
    const body = z
      .object({
        sellerId: z.string().optional(),
        seller: z.object({ type: z.enum(['shop', 'person']), name: z.string().max(120).optional(), address: z.string().max(250).optional(), phone: z.string().max(40).optional() }).optional(),
        returnToFeed: z.boolean().default(true),
      })
      .refine((b) => b.sellerId || b.seller)
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const [i] = await db.select().from(schema.installments).where(eq(schema.installments.id, id));
    if (!i) return reply.code(404).send({ error: 'not_found' });
    const sellerId = body.data.sellerId ?? (await findOrCreateSeller(ctx, body.data.seller!));
    const [exists] = await db.select().from(schema.sellers).where(eq(schema.sellers.id, sellerId));
    if (!exists) return reply.code(404).send({ error: 'seller_not_found' });
    await db
      .update(schema.installments)
      .set({ sellerId, sellerType: exists.type, doubtRequests: 0, doubtful: false, ...(body.data.returnToFeed ? { feedState: 'visible' } : {}) })
      .where(eq(schema.installments.id, id));
    await db.insert(schema.sellerHistory).values({ id: newId(), installmentId: id, oldSellerId: i.sellerId, newSellerId: sellerId, by: `admin:${a.id}` });
    await sellerFixed(ctx, id, i.title);
    await audit(ctx, a, 'change_seller', 'installment', id, { sellerId: i.sellerId, feedState: i.feedState }, { sellerId, feedState: body.data.returnToFeed ? 'visible' : i.feedState });
    return { ok: true };
  });

  app.post('/api/admin/installments/:id/state', async (req, reply) => {
    const a = need(req, reply);
    if (!a) return;
    const { id } = req.params as { id: string };
    const body = z.object({ state: z.enum(['visible', 'hidden', 'trash']) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const [i] = await db.select().from(schema.installments).where(eq(schema.installments.id, id));
    if (!i) return reply.code(404).send({ error: 'not_found' });
    await db.update(schema.installments).set({ feedState: body.data.state, trashedAt: body.data.state === 'trash' ? ctx.now() : null }).where(eq(schema.installments.id, id));
    await audit(ctx, a, 'set_state', 'installment', id, { feedState: i.feedState }, { feedState: body.data.state });
    return { ok: true };
  });

  // Корзина (30 дней) и журнал
  app.get('/api/admin/trash', async (req, reply) => {
    const a = need(req, reply);
    if (!a) return;
    const rows = await db.select().from(schema.installments).where(eq(schema.installments.feedState, 'trash'));
    return { items: await Promise.all(rows.map(async (r) => ({ ...(await recordCard(ctx, r)), trashedAt: r.trashedAt }))) };
  });

  app.get('/api/admin/audit', async (req, reply) => {
    const a = need(req, reply);
    if (!a) return;
    const rows = await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.createdAt)).limit(200);
    return { items: rows };
  });

  // Продавцы
  app.get('/api/admin/sellers', async (req, reply) => {
    const a = need(req, reply);
    if (!a) return;
    const q = z.object({ q: z.string().max(100).default('') }).parse(req.query).q.trim().toLowerCase();
    const rows = await db.select().from(schema.sellers);
    const items = rows.filter((s) => !q || s.nameNorm.includes(q) || s.phone.includes(q.replace(/\D/g, '') || '\u0000'));
    return { items: items.slice(0, 100) };
  });

  app.patch('/api/admin/sellers/:id', async (req, reply) => {
    const a = need(req, reply);
    if (!a) return;
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().max(120), address: z.string().max(250), phone: z.string().max(40), hidden: z.boolean() }).partial().safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const [s] = await db.select().from(schema.sellers).where(eq(schema.sellers.id, id));
    if (!s) return reply.code(404).send({ error: 'not_found' });
    const { normalizePhone, normalizeName } = await import('../security.js');
    const patch: Partial<typeof s> = {};
    if (body.data.name !== undefined) {
      patch.name = body.data.name.trim();
      patch.nameNorm = normalizeName(body.data.name);
    }
    if (body.data.address !== undefined) patch.address = body.data.address.trim();
    if (body.data.phone !== undefined) patch.phone = normalizePhone(body.data.phone);
    if (body.data.hidden !== undefined) patch.hidden = body.data.hidden;
    await db.update(schema.sellers).set(patch).where(eq(schema.sellers.id, id));
    await audit(ctx, a, 'edit_seller', 'seller', id, s, { ...s, ...patch });
    return { ok: true };
  });

  // Объединение дублей: все записи переезжают к «основному» продавцу.
  app.post('/api/admin/sellers/merge', async (req, reply) => {
    const a = need(req, reply);
    if (!a) return;
    const body = z.object({ fromId: z.string(), toId: z.string() }).safeParse(req.body);
    if (!body.success || body.data.fromId === body.data.toId) return reply.code(400).send({ error: 'invalid_input' });
    const [from] = await db.select().from(schema.sellers).where(eq(schema.sellers.id, body.data.fromId));
    const [to] = await db.select().from(schema.sellers).where(eq(schema.sellers.id, body.data.toId));
    if (!from || !to) return reply.code(404).send({ error: 'not_found' });
    const moved = await db.update(schema.installments).set({ sellerId: to.id }).where(eq(schema.installments.sellerId, from.id)).returning({ id: schema.installments.id });
    await db.delete(schema.sellers).where(eq(schema.sellers.id, from.id));
    await audit(ctx, a, 'merge_sellers', 'seller', to.id, { from }, { to: to.id, moved: moved.length });
    return { ok: true, moved: moved.length };
  });

  // Отзывы о приложении
  app.get('/api/admin/feedback', async (req, reply) => {
    const a = need(req, reply);
    if (!a) return;
    const rows = await db.select({ id: schema.feedback.id, text: schema.feedback.text, status: schema.feedback.status, createdAt: schema.feedback.createdAt }).from(schema.feedback).orderBy(desc(schema.feedback.createdAt));
    return { items: rows };
  });

  app.patch('/api/admin/feedback/:id', async (req, reply) => {
    const a = need(req, reply);
    if (!a) return;
    const body = z.object({ status: z.enum(['new', 'planned', 'closed']) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    const id = (req.params as { id: string }).id;
    await db.update(schema.feedback).set({ status: body.data.status }).where(eq(schema.feedback.id, id));
    await audit(ctx, a, 'feedback_status', 'feedback', id, null, { status: body.data.status });
    return { ok: true };
  });
}

/** Окончательно удаляет записи, пролежавшие в корзине больше 30 дней. */
export async function purgeTrash(ctx: Ctx): Promise<number> {
  const cutoff = new Date(ctx.now().getTime() - TRASH_MS);
  const old = await ctx.db
    .select({ id: schema.installments.id })
    .from(schema.installments)
    .where(and(eq(schema.installments.feedState, 'trash'), lt(schema.installments.trashedAt, cutoff)));
  for (const r of old) {
    await ctx.db.delete(schema.installmentEvents).where(eq(schema.installmentEvents.installmentId, r.id));
    await ctx.db.delete(schema.installments).where(eq(schema.installments.id, r.id));
  }
  return old.length;
}

