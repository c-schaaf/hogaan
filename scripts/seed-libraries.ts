import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { getDb } from '../src/shared/db/client.js';
import {
  crisisResourcesV1,
  dailyPromptsV1,
  promptTemplatesV2Unified,
  publishLibraryVersion,
  scenariosV1,
} from '../src/libraries/index.js';
import { libraryVersions } from '../src/shared/db/schema/library-versions.js';
import type { LibraryName } from '../src/libraries/index.js';
import { loadConfig } from '../src/shared/secrets/config.js';

// Baseline seed for libraries that still ship seed payloads from the repo:
//   - prompt_templates v2_unified (the active Values-Driven Companion prompt)
//   - crisis_resources v1 (Tabaha + Befrienders; placeholder superseded by v2
//     via scripts/publish-crisis-resources-v2.ts)
//   - scenarios v1, daily_prompts v1
//
// Removed in SCRUM-43/47: voice_rules v1, cultural_framing v1, prompt_templates v1.
// Those seeds were tied to the v1 multi-block assembly path which no longer
// exists; voice-rules and cultural-framing libraries are no longer loaded
// at runtime, and the v1 prompt template would crash on the simplified
// assembler.
//
// Re-running this script is idempotent. When a library already has a newer
// active version, we skip the lower-version row entirely so re-runs cannot
// demote a superseded version.

async function main(): Promise<void> {
  const config = loadConfig();
  const { db, close } = getDb(config);

  const seeds = [
    {
      libraryName: 'prompt_templates' as const,
      version: 'v2_unified',
      payload: promptTemplatesV2Unified,
      notes:
        'Values-Driven Companion unified prompt (2026-05-13). Single systemText subsumes all five response modes.',
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
