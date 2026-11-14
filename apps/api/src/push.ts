import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createRequire } from 'node:module';
import type * as WebPush from 'web-push';
import { z } from 'zod';
import { requireUser } from './auth.js';
import { type Ctx } from './context.js';
import { schema } from './db/index.js';
import { newId } from './security.js';
import { buildHome } from './routes/home.js';

const webpush = createRequire(import.meta.url)('web-push') as typeof WebPush;

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export type PushResult = { ok: true } | { ok: false; gone: boolean; error: string };
export type PushSender = (target: PushTarget, payload: PushPayload) => Promise<PushResult>;

const MAX_ATTEMPTS = 3;
const SEND_WINDOW_MIN = 6 * 60; // напоминание не позже чем через 6 часов после выбранного времени

/** Настоящая отправка через Web Push (ключи VAPID берутся из настроек сервера). */
export function createWebPushSender(vapid: { publicKey: string; privateKey: string; subject: string }): PushSender {
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  return async (t, payload) => {
    try {
      await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(payload));
      return { ok: true };
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      return { ok: false, gone: status === 404 || status === 410, error: String((e as Error).message).slice(0, 200) };
    }
  };
}

const money = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;

/** Отправить одно уведомление один раз (по ключу), с повторными попытками и отпиской недействительных подписок. */
async function deliver(ctx: Ctx, send: PushSender, userId: string, key: string, kind: string, payload: PushPayload): Promise<'sent' | 'skipped' | 'failed'> {
  const [log] = await ctx.db.select().from(schema.pushLog).where(eq(schema.pushLog.dedupeKey, key));
  if (log && (log.status === 'sent' || log.attempts >= MAX_ATTEMPTS)) return 'skipped';
  const subs = await ctx.db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId));
  if (subs.length === 0) return 'skipped';
  let anyOk = false;
  let lastError = '';
  for (const s of subs) {
    const r = await send({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload);
    if (r.ok) anyOk = true;
    else {
      lastError = r.error;
      if (r.gone) await ctx.db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, s.id));
    }
  }
  const status = anyOk ? 'sent' : 'failed';
  if (log) await ctx.db.update(schema.pushLog).set({ status, attempts: log.attempts + 1, error: anyOk ? null : lastError }).where(eq(schema.pushLog.id, log.id));
  else await ctx.db.insert(schema.pushLog).values({ id: newId(), userId, dedupeKey: key, kind, status, error: anyOk ? null : lastError, createdAt: ctx.now() });
  return anyOk ? 'sent' : 'failed';
}

/**
 * Один проход: напоминания о платежах (за день, в день платежа, просрочка) и push по уведомлениям
 * (просьба проверить продавца, «автор подтвердил/исправил»). Вызывается по расписанию, повторно безопасен.
 */
export async function runReminders(ctx: Ctx, send: PushSender): Promise<{ sent: number }> {
  let sent = 0;
  const users = await ctx.db.select().from(schema.users).where(eq(schema.users.pushEnabled, true));
  for (const u of users) {
    if (u.deletedAt) continue;
    const local = new Date(ctx.now().getTime() + u.timezoneOffsetMin * 60_000);
    const today = local.toISOString().slice(0, 10);
    const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes();
    const [h, m] = u.reminderTime.split(':').map(Number) as [number, number];
    const target = h * 60 + m;

    if (nowMin >= target && nowMin < target + SEND_WINDOW_MIN) {
      const home = await buildHome(ctx, u, today);
      const tomorrow = new Date(Date.parse(today) + 86400_000).toISOString().slice(0, 10);
      for (const a of home.attention as { kind: string; id?: string; dueDate?: string; amount?: number; title?: string }[]) {
        if (a.kind === 'overdue') {
          const r = await deliver(ctx, send, u.id, `${u.id}:${today}:overdue:${a.id}:${a.dueDate}`, 'payment_overdue', {
            title: 'Платёж просрочен',
            body: `${a.title}: ${money(a.amount ?? 0)}`,
            url: '/',
          });
          if (r === 'sent') sent++;
        }
      }
      for (const up of home.upcoming) {
        const when = up.dueDate === today ? 'today' : up.dueDate === tomorrow ? 'tomorrow' : null;
        if (!when) continue;
        const r = await deliver(ctx, send, u.id, `${u.id}:${up.dueDate}:${when}:${up.id}`, 'payment_due', {
          title: when === 'today' ? 'Платёж сегодня' : 'Платёж завтра',
          body: `${up.title}: ${money(up.amount)}`,
          url: '/',
        });
        if (r === 'sent') sent++;
      }
    }

    const notes = await ctx.db.select().from(schema.notifications).where(eq(schema.notifications.userId, u.id));
    for (const n of notes) {
      if (n.readAt || !['check_seller', 'author_confirmed', 'author_fixed'].includes(n.kind)) continue;
      const title = (n.payload as { title?: string }).title ?? 'покупке';
      const text =
        n.kind === 'check_seller'
          ? { title: 'Проверьте данные продавца', body: `Не удалось связаться с продавцом: ${title}` }
          : n.kind === 'author_confirmed'
            ? { title: 'Автор подтвердил данные', body: title }
            : { title: 'Автор исправил данные', body: title };
      const r = await deliver(ctx, send, u.id, `notif:${n.id}`, n.kind, { ...text, url: '/' });
      if (r === 'sent') sent++;
    }
  }
  return { sent };
}

export function pushRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/push/public-key', async () => ({ publicKey: ctx.config.vapid?.publicKey ?? null }));

  app.post('/api/push/subscribe', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const body = z
      .object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    await ctx.db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, body.data.endpoint));
    await ctx.db.insert(schema.pushSubscriptions).values({ id: newId(), userId: u.id, endpoint: body.data.endpoint, p256dh: body.data.keys.p256dh, auth: body.data.keys.auth });
    return reply.code(201).send({ ok: true });
  });

  app.post('/api/push/unsubscribe', async (req, reply) => {
    const u = requireUser(req, reply);
    if (!u) return;
    const body = z.object({ endpoint: z.string().max(1000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_input' });
    await ctx.db.delete(schema.pushSubscriptions).where(and(eq(schema.pushSubscriptions.endpoint, body.data.endpoint), eq(schema.pushSubscriptions.userId, u.id)));
    return { ok: true };
  });
}

