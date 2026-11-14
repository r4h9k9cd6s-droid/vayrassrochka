import { and, eq, gte, sql } from 'drizzle-orm';
import type { Ctx } from './context.js';
import { schema } from './db/index.js';
import { newId } from './security.js';

/** Простое ограничение числа действий: true — можно, false — слишком часто. */
export async function rateAllow(ctx: Ctx, key: string, limit: number, windowSec: number): Promise<boolean> {
  const since = new Date(ctx.now().getTime() - windowSec * 1000);
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.rateEvents)
    .where(and(eq(schema.rateEvents.key, key), gte(schema.rateEvents.createdAt, since)));
  if ((row?.n ?? 0) >= limit) return false;
  await ctx.db.insert(schema.rateEvents).values({ id: newId(), key, createdAt: ctx.now() });
  return true;
}
