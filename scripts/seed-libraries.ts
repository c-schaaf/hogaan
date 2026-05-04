import 'dotenv/config';
import { getDb } from '../src/shared/db/client.js';
import {
  crisisResourcesV1,
  culturalFramingV1,
  promptTemplatesV1,
  publishLibraryVersion,
  scenariosV1,
  voiceRulesV1,
} from '../src/libraries/index.js';
import { loadConfig } from '../src/shared/secrets/config.js';

// Sign-off record (2026-05-04):
//   - voice_rules v1, cultural_framing v1, prompt_templates v1, scenarios v1:
//     APPROVED by Hamse. See scripts/attest-library-signoffs.ts for the
//     attestation that updates library_versions.published_by + notes.
//   - crisis_resources v1 placeholder superseded by v2 — see
//     scripts/publish-crisis-resources-v2.ts.
//
// This script is the v1 baseline seed. Re-running it is idempotent and will
// NOT overwrite sign-off attestations recorded by the attestation script.

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, close } = getDb(config);

  const seeds = [
    {
      libraryName: 'voice_rules' as const,
      version: 'v1',
      payload: voiceRulesV1,
      notes: 'engineering baseline from PRD §7 — pending Hamse sign-off',
    },
    {
      libraryName: 'cultural_framing' as const,
      version: 'v1',
      payload: culturalFramingV1,
      notes: 'engineering baseline from PRD §7 — pending Hamse sign-off',
    },
    {
      libraryName: 'prompt_templates' as const,
      version: 'v1',
      payload: promptTemplatesV1,
      notes: 'engineering baseline — 5 templates, 12 practice framings, 4 level framings',
    },
    {
      libraryName: 'crisis_resources' as const,
      version: 'v1',
      payload: crisisResourcesV1,
      notes: 'minimal MVP: Tabaha + Befrienders Worldwide; Phase 2 expansion deferred',
    },
    {
      libraryName: 'scenarios' as const,
      version: 'v1',
      payload: scenariosV1,
      notes: '12 independent scenarios, one per practice; retakes allowed',
    },
  ];

  for (const seed of seeds) {
    const res = await publishLibraryVersion(db, {
      libraryName: seed.libraryName,
      version: seed.version,
      payload: seed.payload,
      publishedBy: 'system:seed-script',
      notes: seed.notes,
      makeActive: true,
    });
    console.log(
      `${res.libraryName}@${res.version} hash=${res.hash.slice(0, 12)} active=${res.active} alreadyExisted=${res.alreadyExisted}`,
    );
  }

  await close();
}

main().catch((err: unknown) => {
  console.error('seed failed:', err);
  process.exit(1);
});
