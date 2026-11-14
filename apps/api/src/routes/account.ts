import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { endSession, requireUser, startSession, type User } from '../auth.js';
import type { Ctx } from '../context.js';
import { schema } from '../db/index.js';
import { rateAllow } from '../rate.js';
import {
  generateBackupCode,
  hashBackupCode,
  hashSecret,
  newId,
  normalizeLogin,
  verifyBackupCode,
  verifySecret,
} from '../security.js';

const login = z.string().transform(normalizeLogin).pipe(z.string().regex(/^[\p{L}\p{N}_.-]{3,32}$/u));
const password = z.string().min(8).max(200);

export function publicUser(u: User) {
  return {
    id: u.id,
    login: u.login,
    backupCodeAcked: u.backupCodeAcked,
    theme: u.theme,
    hideAmounts: u.hideAmounts,
    pushEnabled: u.pushEnabled,
    reminderTime: u.reminderTime,
    avatar: u.avatar,
    welcomeSeen: u.welcomeSeen,
  };
}

const ip = (req: FastifyRequest) => req.ip;

export function accountRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

  app.post('/api/auth/register', async (req, reply) => {
    const body = z.object({ login, password }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!(await rateAllow(ctx, `register:${ip(req)}`, 10, 3600))) return reply.code(429).send({ error: 'too_many_requests' });
    const [exists] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.login, body.data.login));
    if (exists) return reply.code(409).send({ error: 'login_taken' });
    const backupCode = generateBackupCode();
    const id = newId();
    await db.insert(schema.users).values({
      id,
      login: body.data.login,
      passwordHash: await hashSecret(body.data.password),
      backupCodeHash: await hashBackupCode(backupCode),
      lastSeenAt: ctx.now(),
    });
    await startSession(ctx, reply, id);
    // Код показывается один раз: в базе остаётся только хеш.
    return reply.code(201).send({ backupCode });
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ login, password: z.string().max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!(await rateAllow(ctx, `login:${ip(req)}:${body.data.login}`, 10, 900))) {
      return reply.code(429).send({ error: 'too_many_requests' });
    }
    const [u] = await db.select().from(schema.users).where(eq(schema.users.login, body.data.login));
    if (!u || u.deletedAt || !(await verifySecret(u.passwordHash, body.data.password))) {
      return reply.code(401).send({ error: 'wrong_credentials' });
    }
    await startSession(ctx, reply, u.id);
    return { user: publicUser(u) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await endSession(ctx, req, reply);
    return { ok: true };
  });

  // Сброс пароля по логину и резервному коду; после этого выдаётся новый код.
  app.post('/api/auth/reset', async (req, reply) => {
    const body = z.object({ login, backupCode: z.string().max(40), newPassword: password }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!(await rateAllow(ctx, `reset:${ip(req)}:${body.data.login}`, 5, 900))) {
      return reply.code(429).send({ error: 'too_many_requests' });
    }
    const [u] = await db.select().from(schema.users).where(eq(schema.users.login, body.data.login));
    if (!u || u.deletedAt || !(await verifyBackupCode(u.backupCodeHash, body.data.backupCode))) {
      return reply.code(401).send({ error: 'wrong_credentials' });
    }
    const backupCode = generateBackupCode();
    await db
      .update(schema.users)
      .set({
        passwordHash: await hashSecret(body.data.newPassword),
        backupCodeHash: await hashBackupCode(backupCode),
        backupCodeAcked: false,
      })
      .where(eq(schema.users.id, u.id));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, u.id));
    await startSession(ctx, reply, u.id);
    return { backupCode };
  });

  app.get('/api/me', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    return { user: publicUser(u) };
  });

  app.patch('/api/me/settings', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const body = z
      .object({
        theme: z.enum(['auto', 'light', 'dark']),
        hideAmounts: z.boolean(),
        pushEnabled: z.boolean(),
        reminderTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        timezoneOffsetMin: z.number().int().min(-720).max(840),
        avatar: z.string().max(150_000).regex(/^data:image\/(png|jpeg|webp);base64,/).nullable(),
        welcomeSeen: z.boolean(),
      })
      .partial()
      .strict()
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    if (Object.keys(body.data).length > 0) await db.update(schema.users).set(body.data).where(eq(schema.users.id, u.id));
    const [fresh] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
    return { user: publicUser(fresh!) };
  });

  app.post('/api/me/backup-code/ack', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    await db.update(schema.users).set({ backupCodeAcked: true }).where(eq(schema.users.id, u.id));
    return { ok: true };
  });

  // Новый резервный код после ввода пароля; старый перестаёт работать.
  app.post('/api/me/backup-code/renew', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const body = z.object({ password: z.string().max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!(await rateAllow(ctx, `renew:${u.id}`, 10, 900))) return reply.code(429).send({ error: 'too_many_requests' });
    if (!(await verifySecret(u.passwordHash, body.data.password))) return reply.code(401).send({ error: 'wrong_credentials' });
    const backupCode = generateBackupCode();
    await db
      .update(schema.users)
      .set({ backupCodeHash: await hashBackupCode(backupCode), backupCodeAcked: false })
      .where(eq(schema.users.id, u.id));
    return { backupCode };
  });

  app.post('/api/me/password', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const body = z.object({ oldPassword: z.string().max(200), newPassword: password }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!(await rateAllow(ctx, `chpass:${u.id}`, 10, 900))) return reply.code(429).send({ error: 'too_many_requests' });
    if (!(await verifySecret(u.passwordHash, body.data.oldPassword))) return reply.code(401).send({ error: 'wrong_credentials' });
    await db.update(schema.users).set({ passwordHash: await hashSecret(body.data.newPassword) }).where(eq(schema.users.id, u.id));
    return { ok: true };
  });

  // Удаление аккаунта: личные данные стираются; записи ленты остаются обезличенно, если продавец определён.
  app.delete('/api/me', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const body = z.object({ password: z.string().max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!(await verifySecret(u.passwordHash, body.data.password))) return reply.code(401).send({ error: 'wrong_credentials' });
    const mine = await db.select().from(schema.installments).where(eq(schema.installments.userId, u.id));
    for (const inst of mine) {
      const keep = inst.published && inst.sellerId !== null;
      if (keep) {
        await db.update(schema.installments).set({ userId: null }).where(eq(schema.installments.id, inst.id));
        await db.delete(schema.installmentEvents).where(eq(schema.installmentEvents.installmentId, inst.id));
      } else {
        await db.delete(schema.installmentEvents).where(eq(schema.installmentEvents.installmentId, inst.id));
        await db.delete(schema.installments).where(eq(schema.installments.id, inst.id));
      }
    }
    const pots = await db.select().from(schema.pots).where(eq(schema.pots.userId, u.id));
    for (const p of pots) await db.delete(schema.potPayments).where(eq(schema.potPayments.potId, p.id));
    await db.delete(schema.pots).where(eq(schema.pots.userId, u.id));
    await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, u.id));
    await db.delete(schema.notifications).where(eq(schema.notifications.userId, u.id));
    await db.delete(schema.contactReports).where(eq(schema.contactReports.userId, u.id));
    await db.delete(schema.sessions).where(eq(schema.sessions.userId, u.id));
    await db.delete(schema.users).where(and(eq(schema.users.id, u.id)));
    reply.clearCookie('sid', { path: '/' });
    return { ok: true };
  });

  app.post('/api/feedback', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const body = z.object({ text: z.string().trim().min(1).max(2000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    if (!(await rateAllow(ctx, `feedback:${u.id}`, 10, 86400))) return reply.code(429).send({ error: 'too_many_requests' });
    await db.insert(schema.feedback).values({ id: newId(), userId: u.id, text: body.data.text });
    return reply.code(201).send({ ok: true });
  });
}
