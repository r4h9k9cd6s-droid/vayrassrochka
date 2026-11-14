import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx } from './context.js';
import { schema } from './db/index.js';
import { newToken, sha256 } from './security.js';

export type User = typeof schema.users.$inferSelect;

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

const YEAR_MS = 365 * 24 * 3600 * 1000;
export const COOKIE = 'sid';

export async function startSession(ctx: Ctx, reply: FastifyReply, userId: string): Promise<void> {
  const token = newToken();
  await ctx.db.insert(schema.sessions).values({
    id: sha256(token),
    userId,
    expiresAt: new Date(ctx.now().getTime() + YEAR_MS),
  });
  reply.setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.config.secureCookies,
    path: '/',
    maxAge: YEAR_MS / 1000,
  });
}

export async function endSession(ctx: Ctx, req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies[COOKIE];
  if (token) await ctx.db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  reply.clearCookie(COOKIE, { path: '/' });
}

export async function loadUser(ctx: Ctx, req: FastifyRequest): Promise<User | null> {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  const [row] = await ctx.db
    .select({ user: schema.users, expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, sha256(token)));
  if (!row || row.expiresAt < ctx.now() || row.user.deletedAt) return null;
  // «Автор не заходил больше 2 месяцев» — обновляем отметку не чаще раза в час.
  if (ctx.now().getTime() - row.user.lastSeenAt.getTime() > 3600_000) {
    await ctx.db.update(schema.users).set({ lastSeenAt: ctx.now() }).where(eq(schema.users.id, row.user.id));
  }
  return row.user;
}

export function requireUser(req: FastifyRequest, reply: FastifyReply): User | null {
  if (!req.user) {
    void reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return req.user;
}
