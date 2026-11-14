import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPostgresDb } from './db/index.js';

const config = loadConfig();
const { db } = await createPostgresDb(config.databaseUrl);
const app = buildApp({ db, config, now: () => new Date() });

app.listen({ port: config.port, host: '0.0.0.0' }).catch((err) => {
  console.error(err);
  process.exit(1);
});
