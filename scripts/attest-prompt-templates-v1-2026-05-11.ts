import 'dotenv/config';
import postgres from 'postgres';

/**
 * Records Hamse's 2026-05-11 sign-off on the prompt_templates v1
 * re-published today (new hash 23544283ee21) covering the
 * experience-band calibration directive added to coaching_main_v3
 * as a follow-up to PR #23.
 *
 * What's new in this v1 vs the 2026-05-10 re-publication:
 *   - coaching_main_v3 Hard constraints block now includes an
 *     "Experience-band calibration" section that maps each band
 *     (<5 / 5-10 / 10+) to a depth/tone target, plus a legacy-user
 *     fallback default.
 *
 * Idempotent: no-op if published_by already records this attestation.
 */

const SIGNED_BY = 'hamse@hogaan-team:signed-off-2026-05-11';
const ATTESTATION =
  'Hamse Warfa attests to the prompt_templates v1 re-publication on 2026-05-11 ' +
  'adding the experience-band calibration directive to coaching_main_v3. The ' +
  'directive maps each band to a coaching depth/tone target: Less than 5 years ' +
  '(foundational, first-time-manager context, explain frameworks); 5 to 10 ' +
  'years (peer tone, manager-of-managers context, engage with the second-order ' +
  'question); Over 10 years (exec/founder context, engage as a peer, skip ' +
  'primers, direct). Missing-band fallback uses the 5-to-10 default. The prior ' +
  '2026-05-10 directives (profile_ack_v1 practice-name discipline; ' +
  'coaching_main_v3 no-clarifier-only first turn) remain in place. Approved.';

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
