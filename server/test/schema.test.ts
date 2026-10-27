import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db';

const schemaOf = (db: BetterSqlite3.Database) =>
  db
    .prepare("select type, name, tbl_name, sql from sqlite_master where sql is not null and name not like 'kysely_%' and name not like 'sqlite_%' and name not like 'd1_%' order by type, name")
    .all();

describe('Cloudflare D1 migrations', () => {
  it('produce exactly the schema of the Kysely migrations', async () => {
    const path = join(tmpdir(), `sw-schema-${Date.now()}.db`);
    const h = await openDatabase(path);
    await h.close();
    const fromKysely = new BetterSqlite3(path);
    const expected = schemaOf(fromKysely);
    fromKysely.close();
    rmSync(path, { force: true });

    const dir = new URL('../../worker/migrations/', import.meta.url).pathname;
    const d1 = new BetterSqlite3(':memory:');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) d1.exec(readFileSync(join(dir, file), 'utf8'));
    expect(schemaOf(d1)).toEqual(expected);
    d1.close();
  });
});
