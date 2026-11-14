import type { Config } from './config.js';
import type { Db } from './db/index.js';

export interface Ctx {
  db: Db;
  config: Config;
  /** Текущее время (подменяется в тестах). */
  now: () => Date;
}

/** Сегодняшняя дата в часовом поясе пользователя, «ГГГГ-ММ-ДД». */
export function todayFor(ctx: Ctx, offsetMin: number): string {
  const d = new Date(ctx.now().getTime() + offsetMin * 60_000);
  return d.toISOString().slice(0, 10);
}
