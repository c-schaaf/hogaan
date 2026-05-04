import 'dotenv/config';
import postgres from 'postgres';

const url = process.env['DATABASE_URL'];
if (url === undefined || url === '') {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const sql = postgres(url, { prepare: false });

async function main(): Promise<void> {
  // Extensions
  const extensions = await sql<{ extname: string }[]>`
    SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pgcrypto') ORDER BY extname
  `;
  console.log('extensions:', extensions.map((r) => r.extname).join(', '));

  // Tables
  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  console.log('tables:');
  for (const t of tables) {
    console.log('  ', t.table_name);
  }

  // Enums
  const enums = await sql<{ typname: string; n_values: number }[]>`
    SELECT t.typname, COUNT(e.enumlabel)::int AS n_values
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    GROUP BY t.typname
    ORDER BY t.typname
  `;
  console.log('enums:');
  for (const e of enums) {
    console.log('  ', e.typname, '(', e.n_values, 'values )');
  }

  // memories.embedding column type
  const vec = await sql<{ data_type: string; udt_name: string }[]>`
    SELECT data_type, udt_name FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'embedding'
  `;
  console.log('memories.embedding:', vec[0]?.data_type, vec[0]?.udt_name);

  // HNSW index on memories
  const idx = await sql<{ indexname: string; indexdef: string }[]>`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'memories' AND indexname LIKE '%hnsw%'
  `;
  console.log('memories HNSW index:', idx.length === 0 ? 'MISSING' : idx[0]?.indexname);

  // Audit triggers
  const triggers = await sql<{ trigger_name: string }[]>`
    SELECT trigger_name FROM information_schema.triggers
    WHERE event_object_table = 'audit_log'
    ORDER BY trigger_name
  `;
  console.log('audit_log triggers:', triggers.map((r) => r.trigger_name).join(', ') || 'NONE');

  // Verify audit-log append-only by attempting an UPDATE on a no-op row.
  // We INSERT and then UPDATE; the trigger should raise.
  let appendOnlyConfirmed = false;
  await sql
    .begin(async (txn) => {
      await txn`
      INSERT INTO audit_log (request_id, trigger_source, target_end_event)
      VALUES ('verify-baseline', 'web_session', 'E1')
    `;
      try {
        await txn`UPDATE audit_log SET request_id = 'mutated' WHERE request_id = 'verify-baseline'`;
      } catch (err) {
        if ((err as { code?: string }).code === 'P0001') {
          appendOnlyConfirmed = true;
        } else {
          throw err;
        }
      }
      // Always rollback so the verify row doesn't pollute prod data.
      throw new Error('__rollback');
    })
    .catch((err) => {
      if ((err as Error).message !== '__rollback') {
        throw err;
      }
    });
  console.log('audit_log append-only enforced:', appendOnlyConfirmed);

  // pgvector smoke test: insert + cosine search.
  const vecOk = await sql
    .begin(async (txn) => {
      const v = Array(1024)
        .fill(0)
        .map((_, i) => (i === 0 ? 1 : 0));
      const w = Array(1024)
        .fill(0)
        .map((_, i) => (i === 0 ? 1 : 0));
      const userIdRow = await txn<{ id: string }[]>`
      INSERT INTO users (phone_hash, status) VALUES ('verify-baseline-hash', 'provisional') RETURNING id
    `;
      const userId = userIdRow[0]?.id;
      if (userId === undefined) {
        return 'no-user';
      }
      await txn`
      INSERT INTO memories (user_id, content, embedding)
      VALUES (${userId}, 'verify-baseline', ${`[${v.join(',')}]`}::vector)
    `;
      const result = await txn<{ similarity: number }[]>`
      SELECT 1 - (embedding <=> ${`[${w.join(',')}]`}::vector) AS similarity
      FROM memories WHERE content = 'verify-baseline'
    `;
      throw new Error(`__rollback:${result[0]?.similarity ?? 'no-result'}`);
    })
    .catch((err) => {
      const m = (err as Error).message;
      if (m.startsWith('__rollback:')) {
        return m.substring('__rollback:'.length);
      }
      throw err;
    });
  console.log('pgvector cosine self-similarity (expect ~1):', vecOk);

  await sql.end({ timeout: 5 });
}

main().catch((err: unknown) => {
  console.error('verify failed:', err);
  process.exit(1);
});
