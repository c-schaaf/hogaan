import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../src/shared/db/client.js';
import {
  crisisResourcesV1,
  culturalFramingV1,
  dailyPromptsV1,
  promptTemplatesV1,
  publishLibraryVersion,
  scenariosV1,
  voiceRulesV1,
} from '../src/libraries/index.js';
import { libraryVersions } from '../src/shared/db/schema/library-versions.js';
import type { LibraryName } from '../src/libraries/index.js';
import { loadConfig } from '../src/shared/secrets/config.js';

// Sign-off record (2026-05-04):
//   - voice_rules v1, cultural_framing v1, prompt_templates v1, scenarios v1:
//     APPROVED by Hamse. See scripts/attest-library-signoffs.ts for the
//     attestation that updates library_versions.published_by + notes.
//   - crisis_resources v1 placeholder superseded by v2 — see
//     scripts/publish-crisis-resources-v2.ts.
//
// This script is the v1 baseline seed. Re-running it is idempotent. Critically,
// when a library already has a newer active version (e.g. crisis_resources v2),
// we skip the v1 row entirely so re-runs cannot demote a superseded version.
// makeActive is computed dynamically per library based on current state.

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
    {
      libraryName: 'daily_prompts' as const,
      version: 'v1',
      payload: dailyPromptsV1,
      notes:
        '24 daily prompts, 2 per practice; per-user-per-day deterministic selection with practice rotation',
    },
  ];

  for (const seed of seeds) {
    // Detect: is a NEWER version of this library already active?
    const newerActive = await isHigherVersionActive(db, seed.libraryName, seed.version);
    if (newerActive !== null) {
      console.log(
        `${seed.libraryName}@${seed.version} SKIPPED — ${seed.libraryName}@${newerActive} is already active`,
      );
      continue;
    }
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

/**
 * Returns the active version string when a NEWER version than `myVersion` is
 * already active for `name`. Returns null otherwise. Version comparison is
 * lexicographic on the v-prefixed string ('v1' < 'v2' < 'v10' fails — but
 * for v1..v9 the simple comparison is correct, and we'll add proper
 * semver if we ever cross 9 versions).
 */
async function isHigherVersionActive(
  db: ReturnType<typeof getDb>['db'],
  name: LibraryName,
  myVersion: string,
): Promise<string | null> {
  const rows = await db
    .select({ version: libraryVersions.version })
    .from(libraryVersions)
    .where(and(eq(libraryVersions.libraryName, name), eq(libraryVersions.active, true)))
    .limit(1);
  const active = rows[0]?.version;
  if (active === undefined) {
    return null;
  }
  // Compare e.g. v2 > v1.
  return active > myVersion ? active : null;
}

main().catch((err: unknown) => {
  console.error('seed failed:', err);
  process.exit(1);
});
