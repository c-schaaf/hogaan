import 'dotenv/config';
import postgres from 'postgres';

/**
 * Apply the web-app migration (0007) to production. Idempotent: each ALTER
 * is wrapped in an existence check so re-runs are safe. Whole thing runs in
 * a transaction so partial failure rolls back cleanly.
 *
 * Run with: pnpm tsx scripts/apply-web-user-migration.ts
 */

interface ColumnRow {
  column_name: string;
}

interface IndexRow {
  indexname: string;
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL not set');
  }
  const sql = postgres(url, { prepare: false, max: 2, idle_timeout: 5, connect_timeout: 10 });

  try {
    const userCols = await sql<ColumnRow[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
    `;
    const userColSet = new Set(userCols.map((r) => r.column_name));

    const sessionCols = await sql<ColumnRow[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sessions'
    `;
    const sessionColSet = new Set(sessionCols.map((r) => r.column_name));

    const indexes = await sql<IndexRow[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'users'
    `;
    const indexSet = new Set(indexes.map((r) => r.indexname));

    const planned: string[] = [];
    if (!userColSet.has('email')) planned.push('users.email');
    if (!userColSet.has('email_verified_at')) planned.push('users.email_verified_at');
    if (!userColSet.has('password_hash')) planned.push('users.password_hash');
    if (!userColSet.has('full_name_encrypted')) planned.push('users.full_name_encrypted');
    if (!userColSet.has('comm_style')) planned.push('users.comm_style');
    if (!userColSet.has('response_depth')) planned.push('users.response_depth');
    if (!indexSet.has('users_email_unique')) planned.push('users_email_unique index');
    if (!sessionColSet.has('title')) planned.push('sessions.title');
    if (!sessionColSet.has('is_private')) planned.push('sessions.is_private');

    if (planned.length === 0) {
      console.log('All migration targets already present — nothing to do.');
      return;
    }
    console.log(`Applying ${planned.length} change(s):`);
    for (const p of planned) console.log(`  - ${p}`);

    await sql.begin(async (tx) => {
      if (!userColSet.has('email')) {
        await tx`ALTER TABLE "users" ADD COLUMN "email" text`;
      }
      if (!userColSet.has('email_verified_at')) {
        await tx`ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamptz`;
      }
      if (!userColSet.has('password_hash')) {
        await tx`ALTER TABLE "users" ADD COLUMN "password_hash" text`;
      }
      if (!userColSet.has('full_name_encrypted')) {
        await tx`ALTER TABLE "users" ADD COLUMN "full_name_encrypted" text`;
      }
      if (!userColSet.has('comm_style')) {
        await tx`ALTER TABLE "users" ADD COLUMN "comm_style" text`;
      }
      if (!userColSet.has('response_depth')) {
        await tx`ALTER TABLE "users" ADD COLUMN "response_depth" text`;
      }
      if (!indexSet.has('users_email_unique')) {
        await tx`CREATE UNIQUE INDEX "users_email_unique" ON "users" (lower(email)) WHERE email IS NOT NULL`;
      }
      if (!sessionColSet.has('title')) {
        await tx`ALTER TABLE "sessions" ADD COLUMN "title" text`;
      }
      if (!sessionColSet.has('is_private')) {
        await tx`ALTER TABLE "sessions" ADD COLUMN "is_private" boolean NOT NULL DEFAULT false`;
      }
    });

    const after = await sql<ColumnRow[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
        AND column_name IN ('email', 'password_hash', 'comm_style', 'response_depth')
    `;
    console.log(`Post-check: ${after.length} of 4 new user columns present.`);
    if (after.length !== 4) {
      throw new Error('post-migrate verification failed — expected all 4 user columns');
    }
    console.log('Migration applied successfully.');
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('migration failed:', err);
  process.exit(1);
});
