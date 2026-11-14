import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { loadUser } from './auth.js';
import type { Ctx } from './context.js';
import { accountRoutes } from './routes/account.js';

export function buildApp(ctx: Ctx) {
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 400_000 });
  app.register(cookie);
  app.decorateRequest('user', null);

  app.addHook('preHandler', async (req) => {
    req.user = await loadUser(ctx, req);
  });

  app.get('/health', async () => ({ status: 'ok' }));
  accountRoutes(app, ctx);

  return app;
}
