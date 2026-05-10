import 'dotenv/config';
import postgres from 'postgres';

/**
 * Delete the existing prompt_templates v1 row so the seed script can
 * re-publish with the new PR2 + PR3 content (different hash). Captures the
 * old row to console first as audit trail.
 *
 * Run with: pnpm tsx scripts/delete-stale-prompt-templates-v1.ts
 */
async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL not set');
  }
  const sql = postgres(url, { prepare: false, max: 2, idle_timeout: 5, connect_timeout: 10 });

  try {
    const before = await sql<
      {
        id: string;
        library_name: string;
        version: string;
        active: boolean;
        hash: string;
        published_by: string;
        notes: string | null;
      }[]
    >`
      SELECT id, library_name, version, active, hash, published_by, notes
      FROM library_versions
      WHERE library_name = 'prompt_templates'
        AND version = 'v1'
    `;

    if (before.length === 0) {
      console.log('No prompt_templates v1 row found — nothing to delete');
      return;
    }

    console.log('Found existing row(s) to delete:');
    for (const r of before) {
      console.log(
        `  id=${r.id} active=${r.active} hash=${r.hash.slice(0, 16)}... published_by=${r.published_by}`,
      );
      console.log(`    notes=${r.notes ?? '(null)'}`);
    }

    const deleted = await sql`
      DELETE FROM library_versions
      WHERE library_name = 'prompt_templates'
        AND version = 'v1'
      RETURNING id
    `;
    console.log(`Deleted ${deleted.length} row(s)`);

    const after = await sql<{ count: bigint }[]>`
      SELECT COUNT(*) AS count
      FROM library_versions
      WHERE library_name = 'prompt_templates'
        AND version = 'v1'
    `;
    if (Number(after[0]!.count) !== 0) {
      throw new Error(`post-delete check: ${after[0]!.count} rows still present`);
    }
    console.log('OK: prompt_templates v1 cleared. Ready for re-seed.');
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('delete failed:', err);
  process.exit(1);
});
