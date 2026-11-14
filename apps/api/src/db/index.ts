import { fileURLToPath } from 'node:url';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzleLite } from 'drizzle-orm/pglite';
import { migrate as migrateLite } from 'drizzle-orm/pglite/migrator';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<any, typeof schema>;
export { schema };

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function createPostgresDb(url: string): Promise<{ db: Db; close: () => Promise<void> }> {
  const pool = new pg.Pool({ connectionString: url });
  const db = drizzlePg(pool, { schema });
  await migratePg(db, { migrationsFolder });
  return { db, close: () => pool.end() };
}

/** Встроенная копия PostgreSQL в памяти — для автотестов. */
export async function createTestDb(): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = drizzleLite(new PGlite(), { schema });
  await migrateLite(db, { migrationsFolder });
  return db as unknown as Db;
}
