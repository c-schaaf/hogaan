import 'dotenv/config';
import postgres from 'postgres';

/**
 * Apply the experience_band migration to production. Idempotent: checks first,
 * adds column only if missing. Wraps the work in a transaction so any error
 * leaves the DB unchanged.
 *
 * Run with: pnpm tsx scripts/apply-experience-band-migration.ts
 */
async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL not set');
  }
  const sql = postgres(url, { prepare: false, max: 2, idle_timeout: 5, connect_timeout: 10 });

  try {
    const before = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'experience_band'
    `;

    if (before.length > 0) {
      console.log('experience_band already present — nothing to do');
      return;
    }

    console.log('experience_band absent — applying ALTER TABLE…');
    await sql.begin(async (tx) => {
      await tx`ALTER TABLE "users" ADD COLUMN "experience_band" text`;
    });

    const after = await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'experience_band'
    `;
    if (after.length === 0) {
      throw new Error('post-ALTER check: column still absent — something went wrong');
    }
    console.log(`OK: column added — ${JSON.stringify(after[0])}`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('migration failed:', err);
  process.exit(1);
});
