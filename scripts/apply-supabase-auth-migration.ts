import 'dotenv/config';
import postgres from 'postgres';

/**
 * Apply migration 0008 (Supabase Auth support) to production. Idempotent.
 *
 * Run with: pnpm tsx scripts/apply-supabase-auth-migration.ts
 */
interface ColumnRow {
  column_name: string;
}
interface IndexRow {
  indexname: string;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) throw new Error('DATABASE_URL not set');
  const sql = postgres(url, { prepare: false, max: 2, idle_timeout: 5, connect_timeout: 10 });

  try {
    const cols = await sql<ColumnRow[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='users'
    `;
    const colSet = new Set(cols.map((r) => r.column_name));

    const idx = await sql<IndexRow[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname='public' AND tablename='users'
    `;
    const idxSet = new Set(idx.map((r) => r.indexname));

    const planned: string[] = [];
    if (!colSet.has('supabase_user_id')) planned.push('users.supabase_user_id');
    if (!idxSet.has('users_supabase_user_id_unique'))
      planned.push('users_supabase_user_id_unique index');

    if (planned.length === 0) {
      console.log('All migration targets already present — nothing to do.');
      return;
    }
    console.log(`Applying ${planned.length} change(s):`);
    for (const p of planned) console.log(`  - ${p}`);

    await sql.begin(async (tx) => {
      if (!colSet.has('supabase_user_id')) {
        await tx`ALTER TABLE "users" ADD COLUMN "supabase_user_id" uuid`;
      }
      if (!idxSet.has('users_supabase_user_id_unique')) {
        await tx`CREATE UNIQUE INDEX "users_supabase_user_id_unique" ON "users" ("supabase_user_id") WHERE "supabase_user_id" IS NOT NULL`;
      }
    });

    console.log('Migration applied successfully.');
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('migration failed:', err);
  process.exit(1);
});
