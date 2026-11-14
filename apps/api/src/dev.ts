// Режим для проверки на своём компьютере: база в памяти, данные пропадают при остановке.
import { buildApp } from './app.js';
import { testConfig } from './config.js';
import { createTestDb } from './db/index.js';

const db = await createTestDb();
const app = buildApp({ db, config: { ...testConfig, port: 3000 }, now: () => new Date() });
await app.listen({ port: 3000, host: '127.0.0.1' });
console.log('API (тестовая база в памяти): http://127.0.0.1:3000');
