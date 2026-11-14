import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPostgresDb } from './db/index.js';
import { createWebPushSender, runReminders, type PushSender } from './push.js';
import { runFeedMaintenance } from './routes/feed.js';
import { purgeTrash } from './routes/admin.js';

const config = loadConfig();
const { db } = await createPostgresDb(config.databaseUrl);
const ctx = { db, config, now: () => new Date() };
const app = buildApp(ctx);

// Фоновые задачи: напоминания каждую минуту, уборка ленты и корзины раз в час.
const sender: PushSender | null = config.vapid ? createWebPushSender(config.vapid) : null;
if (!sender) console.warn('Ключи VAPID не заданы: push-уведомления выключены.');
const guard = (name: string, fn: () => Promise<unknown>) => () => fn().catch((e) => console.error(`[${name}]`, e));
if (sender) setInterval(guard('reminders', () => runReminders(ctx, sender)), 60_000);
setInterval(guard('maintenance', async () => { await runFeedMaintenance(ctx); await purgeTrash(ctx); }), 3600_000);

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  console.error(err);
  process.exit(1);
});
