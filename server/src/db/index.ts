import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, PostgresDialect, SqliteDialect, sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import pg from 'pg';
import { isPostgresUrl } from '../config';
import { migrations } from './migrations';
import type { Database } from './schema';

export type Db = Kysely<Database>;

export interface DbHandle {
  db: Db;
  dialect: 'sqlite' | 'postgres';
  close(): Promise<void>;
}

export async function openDatabase(url: string): Promise<DbHandle> {
  let db: Db;
  let dialect: DbHandle['dialect'];
  if (isPostgresUrl(url)) {
    const ssl = /sslmode=(require|verify-full|verify-ca)/i.test(url) ? { rejectUnauthorized: !/sslmode=require/i.test(url) } : undefined;
    const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX ?? 10), ssl });
    db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
    dialect = 'postgres';
  } else {
    if (url !== ':memory:') mkdirSync(dirname(url), { recursive: true });
    const sqlite = new BetterSqlite3(url);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    db = new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
    dialect = 'sqlite';
  }

  const migrator = new Migrator({
    db,
    provider: { getMigrations: async () => migrations },
  });
  const { error, results } = await migrator.migrateToLatest();
  for (const r of results ?? []) {
    if (r.status === 'Error') console.error(`Migration ${r.migrationName} failed`);
  }
  if (error) {
    await db.destroy();
    throw error instanceof Error ? error : new Error(String(error));
  }

  return { db, dialect, close: () => db.destroy() };
}

/** Quick connectivity check for health endpoints. */
export async function ping(db: Db): Promise<void> {
  await sql`select 1`.execute(db);
}
