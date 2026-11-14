import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { loadUser } from './auth.js';
import type { Ctx } from './context.js';
import { accountRoutes } from './routes/account.js';
import { feedRoutes } from './routes/feed.js';
import { potRoutes } from './routes/pots.js';
import { adminRoutes } from './routes/admin.js';
import { homeRoutes } from './routes/home.js';
import { pushRoutes } from './push.js';
import { installmentRoutes } from './routes/installments.js';

export function buildApp(ctx: Ctx) {
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 400_000 });
  app.register(cookie);
  app.decorateRequest('user', null);

  app.addHook('preHandler', async (req) => {
    req.user = await loadUser(ctx, req);
  });

  app.get('/health', async () => ({ status: 'ok' }));
  accountRoutes(app, ctx);
  installmentRoutes(app, ctx);
  feedRoutes(app, ctx);
  potRoutes(app, ctx);
  homeRoutes(app, ctx);
  pushRoutes(app, ctx);
  adminRoutes(app, ctx);

  return app;
}
