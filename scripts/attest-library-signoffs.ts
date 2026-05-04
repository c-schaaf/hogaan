import 'dotenv/config';
import { recordSignoff, type LibraryName } from '../src/libraries/index.js';
import { getDb } from '../src/shared/db/client.js';
import { loadConfig } from '../src/shared/secrets/config.js';

/**
 * Hamse signed off on v1 of the four content libraries on 2026-05-04.
 *
 * This script records the attestation against the existing v1 rows by
 * updating `library_versions.published_by` and appending to `notes`.
 *
 * Idempotent: re-running it after the first successful attestation is a
 * no-op. The traceability is preserved in the row's metadata; the payload
 * itself is untouched.
 */

const SIGNED_BY = 'hamse@hogaan-team:signed-off-2026-05-04';

const ATTESTATIONS: { libraryName: LibraryName; version: string; attestation: string }[] = [
  {
    libraryName: 'voice_rules',
    version: 'v1',
    attestation:
      'Hamse Warfa attests that the 10 voice rules and the heroPhraseFlags + ' +
      'usefulToSocietyPatterns catalogs accurately encode his coaching voice for v1. ' +
      'Approved for use under Process #9 §6 and Process #10 Checks 5–6.',
  },
  {
    libraryName: 'cultural_framing',
    version: 'v1',
    attestation:
      'Hamse Warfa attests that the 15 cultural framings (Xeer, Soomaalinimo, ' +
      'Geed daad, Pastoral leadership, Tol, Sahan, Aragti dheer, Refugee resilience, ' +
      'Diaspora bridge, Naxariis, Sharaf, Wadanjirka, Poet as truth-teller, Maslaxad, ' +
      'Hooyo) are faithful translations of the lived concepts. Approved for use under ' +
      'Process #9 §7 with the discipline of one Somali term per response.',
  },
  {
    libraryName: 'prompt_templates',
    version: 'v1',
    attestation:
      'Hamse Warfa attests that the five system templates (coaching_main_v3, ' +
      'profile_ack_v1, clarify_v1, meta_v1, scenario_rolePlay_v1), the 12 practice ' +
      'framing blocks, and the 4 level framing blocks are an accurate engineering ' +
      'rendering of the twelve-practice framework. Approved.',
  },
  {
    libraryName: 'scenarios',
    version: 'v1',
    attestation:
      'Hamse Warfa attests that the 12 leadership scenarios (one per practice) ' +
      'are realistic and brand-aligned for v1. Independent-library model confirmed: ' +
      'all 12 always available, retakes allowed, no prerequisites, completions logged ' +
      'on profile but not fed back into coaching context.',
  },
];

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, close } = getDb(config);

  for (const a of ATTESTATIONS) {
    const res = await recordSignoff(db, {
      libraryName: a.libraryName,
      version: a.version,
      signedBy: SIGNED_BY,
      attestation: a.attestation,
    });
    console.log(
      `${res.libraryName}@${res.version} alreadySignedOff=${res.alreadySignedOff} signedBy=${SIGNED_BY}`,
    );
  }

  await close();
}

main().catch((err: unknown) => {
  console.error('attestation failed:', err);
  process.exit(1);
});
