import { buildApp } from './app.js';
import { testConfig } from './config.js';
import { createTestDb } from './db/index.js';
import type { Ctx } from './context.js';

export async function makeTestApp(opts: { now?: () => Date } = {}) {
  const db = await createTestDb();
  const clock = { current: new Date('2026-03-10T09:00:00Z') };
  const ctx: Ctx = { db, config: testConfig, now: opts.now ?? (() => clock.current) };
  const app = buildApp(ctx);
  return { app, ctx, db, clock };
}

/** Небольшой «браузер» для тестов: помнит cookie между запросами. */
let clientCounter = 0;
export type App = ReturnType<typeof buildApp>;

export class Client {
  private cookie = '';
  private addr = `10.0.${Math.floor(++clientCounter / 250)}.${clientCounter % 250}`;
  constructor(private app: ReturnType<typeof buildApp>) {}
  async call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', url: string, payload?: unknown) {
    const res = await this.app.inject({
      method,
      url,
      payload: payload as object | undefined,
      remoteAddress: this.addr,
      headers: this.cookie ? { cookie: this.cookie } : {},
    });
    const set = res.headers['set-cookie'];
    const line = Array.isArray(set) ? set[0] : set;
    if (line) {
      const pair = line.split(';')[0]!;
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as any) : null }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}
