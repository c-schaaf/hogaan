import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { type AppConfig, requireConfig } from '../secrets/config.js';

export type Database = PostgresJsDatabase;
export type SqlClient = Sql;

interface DbBundle {
  sql: SqlClient;
  db: Database;
  close(): Promise<void>;
}

let cached: DbBundle | undefined;

/**
 * Lazily create the singleton DB connection pool. postgres.js itself is a pool;
 * we deliberately do not expose `new` semantics — every module shares one.
 *
 * Supabase pooler caveat: when DATABASE_URL points at the pgbouncer transaction
 * pool (port 6543), prepared statements are NOT supported — we set
 * `prepare: false` to keep that path safe. The session pooler (5432) and direct
 * connection both support prepares; we accept the small cost rather than
 * branching.
 */
export function getDb(config: AppConfig): DbBundle {
  if (cached) {
    return cached;
  }

  const url = requireConfig(config, 'databaseUrl');

  const sql = postgres(url, {
    prepare: false,
    max: config.nodeEnv === 'test' ? 4 : 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => undefined,
  });

  const db = drizzle(sql);

  cached = {
    sql,
    db,
    close: async () => {
      await sql.end({ timeout: 5 });
      cached = undefined;
    },
  };

  return cached;
}

/** Test/teardown only. Resets the cached singleton — do not use in production code paths. */
export async function resetDbForTests(): Promise<void> {
  if (cached) {
    await cached.close();
  }
}
