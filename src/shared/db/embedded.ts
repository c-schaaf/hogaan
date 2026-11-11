import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { vector } from '@electric-sql/pglite/vector';
import { drizzle } from 'drizzle-orm/pglite';
import type { Database } from './client.js';

/**
 * Embedded Postgres (PGlite — real Postgres compiled to WebAssembly, runs
 * in-process). Used by:
 *   - demo mode (`pnpm demo`), so the app runs with no Supabase project;
 *   - integration tests for the context-and-connections features, so new
 *     SQL (tables, views, privacy floors) is tested against real Postgres
 *     instead of chain-stubs.
 *
 * Never used in production: `src/index.ts` only ever builds the postgres.js
 * pool from DATABASE_URL.
 *
 * Applies every `drizzle/*.sql` migration in filename order, so the embedded
 * schema is the same schema production gets.
 */
export interface EmbeddedDb {
  db: Database;
  pg: PGlite;
  close(): Promise<void>;
}

function locateMigrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/shared/db -> repo root ; dist/shared/db -> repo root
  return path.resolve(here, '../../../drizzle');
}

export async function createEmbeddedDb(opts: { dataDir?: string } = {}): Promise<EmbeddedDb> {
  const extensions = { vector, pgcrypto };
  // PGlite treats `new PGlite(undefined, opts)` as "no options", so pick the
  // constructor form explicitly.
  const pg =
    opts.dataDir !== undefined
      ? new PGlite(opts.dataDir, { extensions })
      : new PGlite({ extensions });
  await pg.waitReady;
  await applyMigrations(pg);
  // drizzle's PGlite driver and its postgres.js driver share the PgDatabase
  // query builder; the app is typed against the postgres.js flavour. The
  // only behavioural difference is the shape of raw `db.execute()` results,
  // which new code avoids (see src/shared/db/rows.ts).
  const db = drizzle(pg) as unknown as Database;
  return {
    db,
    pg,
    close: async () => {
      await pg.close();
    },
  };
}

async function applyMigrations(pg: PGlite): Promise<void> {
  await pg.exec(
    'CREATE TABLE IF NOT EXISTS "_embedded_migrations" (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const done = new Set(
    (await pg.query<{ name: string }>('SELECT name FROM "_embedded_migrations"')).rows.map(
      (r) => r.name,
    ),
  );
  const dir = locateMigrationsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sqlText = readFileSync(path.join(dir, f), 'utf8');
    try {
      await pg.exec(sqlText);
    } catch (err) {
      throw new Error(`embedded migration ${f} failed: ${(err as Error).message}`);
    }
    await pg.query('INSERT INTO "_embedded_migrations"(name) VALUES ($1)', [f]);
  }
}
