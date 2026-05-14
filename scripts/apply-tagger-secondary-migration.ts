import 'dotenv/config';
import postgres from 'postgres';

/**
 * Idempotent applier for drizzle/0005_phase11_tagger_secondary.sql.
 *
 * The local drizzle journal got out of sync after a git pull rewrote migration
 * files (idx 5 was `0005_amused_captain_britain`, on-disk is now
 * `0005_phase11_tagger_secondary`). `drizzle-kit migrate` refuses to recover.
 * This script directly applies the only missing schema change: three nullable
 * text columns on `turns`. It checks first and skips columns that already exist
 * so it's safe to re-run.
 *
 * Bug reference: bug-hunt chunk-1 Finding #3 — streaming turn persist failing
 * with `column "secondary_practice_tag" of relation "turns" does not exist`.
 *
 * Run with: pnpm tsx scripts/apply-tagger-secondary-migration.ts
 */
const COLUMNS_TO_ADD = ['secondary_practice_tag', 'secondary_level_tag', 'tagger_confidence'];

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
        AND table_name = 'turns'
        AND column_name = ANY(${COLUMNS_TO_ADD})
    `;
    const present = new Set(before.map((r) => r.column_name));
    const missing = COLUMNS_TO_ADD.filter((c) => !present.has(c));

    if (missing.length === 0) {
      console.log('all tagger-secondary columns present — nothing to do');
      return;
    }

    console.log(`missing columns on turns: ${missing.join(', ')}`);
    await sql.begin(async (tx) => {
      for (const col of missing) {
        console.log(`  adding ${col}…`);
        await tx.unsafe(`ALTER TABLE "turns" ADD COLUMN "${col}" text`);
      }
    });

    const after = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'turns'
        AND column_name = ANY(${COLUMNS_TO_ADD})
    `;
    const final = new Set(after.map((r) => r.column_name));
    const stillMissing = COLUMNS_TO_ADD.filter((c) => !final.has(c));
    if (stillMissing.length > 0) {
      throw new Error(`post-ALTER check: still missing ${stillMissing.join(', ')}`);
    }
    console.log(`OK: ${missing.length} column(s) added — ${[...final].join(', ')} now present`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('migration failed:', err);
  process.exit(1);
});
