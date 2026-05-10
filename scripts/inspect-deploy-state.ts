import 'dotenv/config';
import postgres from 'postgres';

/**
 * Read-only inspection: report whether the experience_band column exists on
 * users, and what rows currently exist in library_versions for
 * prompt_templates. Bypasses loadConfig — uses DATABASE_URL directly.
 */
async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL not set');
  }
  const sql = postgres(url, { prepare: false, max: 2, idle_timeout: 5, connect_timeout: 10 });

  try {
    console.log('--- users.experience_band column? ---');
    const col = await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'experience_band'
    `;
    if (col.length === 0) {
      console.log('NOT PRESENT — migration needed');
    } else {
      console.log(`PRESENT: ${JSON.stringify(col[0])}`);
    }

    console.log('\n--- library_versions for prompt_templates ---');
    const rows = await sql<
      {
        id: string;
        library_name: string;
        version: string;
        active: boolean;
        hash: string;
        published_by: string | null;
        published_at: Date;
      }[]
    >`
      SELECT id, library_name, version, active, hash, published_by, published_at
      FROM library_versions
      WHERE library_name = 'prompt_templates'
      ORDER BY published_at DESC
    `;
    if (rows.length === 0) {
      console.log('NO ROWS — seed will publish fresh');
    } else {
      for (const r of rows) {
        console.log(
          `  id=${r.id.slice(0, 8)} version=${r.version} active=${r.active} hash=${r.hash.slice(0, 12)}... published_by=${r.published_by ?? '(null)'} published_at=${r.published_at.toISOString()}`,
        );
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('inspect failed:', err);
  process.exit(1);
});
