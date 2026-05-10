import 'dotenv/config';
import postgres from 'postgres';

/**
 * Records Hamse's 2026-05-10 sign-off on the re-seeded prompt_templates v1
 * (new hash 87ee6c703645) covering the PR #21 and PR #22 directive
 * additions:
 *   - profile_ack_v1 practice-name discipline (verbatim, no paraphrasing)
 *   - coaching_main_v3 no-clarifier-only-first-turn hard constraint
 *
 * Does NOT re-attest voice_rules / cultural_framing / scenarios — those keep
 * their 2026-05-04 sign-off. Targets exactly the prompt_templates row whose
 * published_by is currently `system:seed-script` (from the 2026-05-10 reseed).
 *
 * Idempotent: if published_by already records Hamse's 2026-05-10 attestation,
 * exits without writing.
 */

const SIGNED_BY = 'hamse@hogaan-team:signed-off-2026-05-10';
const ATTESTATION =
  'Hamse Warfa attests to the prompt_templates v1 re-publication on 2026-05-10 ' +
  'covering two new directives: (a) profile_ack_v1 practice-name discipline — ' +
  'when the user names specific practices, the coach must echo those names ' +
  'verbatim and not paraphrase them to generic categories; (b) coaching_main_v3 ' +
  'hard constraint — the first substantive turn must deliver Story → Insight → ' +
  'Action even on broad input, never a clarifying question alone. The structural ' +
  'pieces (five system templates, 12 practice framing blocks, 4 level framing ' +
  'blocks) remain as previously approved. Approved.';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL not set');
  }
  const sql = postgres(url, { prepare: false, max: 2, idle_timeout: 5, connect_timeout: 10 });

  try {
    const rows = await sql<
      {
        id: string;
        published_by: string;
        notes: string | null;
      }[]
    >`
      SELECT id, published_by, notes
      FROM library_versions
      WHERE library_name = 'prompt_templates'
        AND version = 'v1'
    `;

    if (rows.length === 0) {
      throw new Error('prompt_templates v1 row not found — was it deleted without reseeding?');
    }
    const row = rows[0]!;

    if (row.published_by === SIGNED_BY) {
      console.log(`Already attested: ${SIGNED_BY}`);
      return;
    }

    console.log(`Updating row id=${row.id}`);
    console.log(`  published_by: ${row.published_by} → ${SIGNED_BY}`);

    const existingNotes = row.notes ?? '';
    const newNotes =
      existingNotes.length === 0
        ? ATTESTATION
        : `${existingNotes}\n--- ${SIGNED_BY} ---\n${ATTESTATION}`;

    await sql`
      UPDATE library_versions
      SET published_by = ${SIGNED_BY}, notes = ${newNotes}
      WHERE id = ${row.id}
    `;

    const verify = await sql<
      { published_by: string; notes: string | null }[]
    >`SELECT published_by, notes FROM library_versions WHERE id = ${row.id}`;
    if (verify[0]!.published_by !== SIGNED_BY) {
      throw new Error('post-update verification failed');
    }
    console.log('OK: attestation recorded.');
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('attestation failed:', err);
  process.exit(1);
});
