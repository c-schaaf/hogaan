import 'dotenv/config';
import {
  canonicalHash,
  getActiveLibraryVersions,
  publishLibraryVersion,
  resetResolverForTests,
  verifyIntegrity,
  voiceRulesV1,
} from '../src/libraries/index.js';
import { getDb } from '../src/shared/db/client.js';
import { loadConfig } from '../src/shared/secrets/config.js';

/**
 * Publish voice_rules v2 — Phase 12 R3 ratified content (Rule 11 added,
 * Rule 10 rewritten to drop bold-encouragement, cross-reference Rule 11).
 *
 * The existing seed export `voiceRulesV1` carries the post-Phase-12 content
 * (the v2 file was inlined into v1 by commit cd0e01b). This script promotes
 * that content as version='v2' in the DB so prompt assembly resolves the
 * same content that voice-consistency uses for its centroid.
 *
 * Background: 2026-05-06 production diagnostic
 * (audit-evidence/phase-12/2026-05-06-phase-12-fallback-diagnostic.md)
 * found the active v1 row was the pre-Phase-12 hash; voice-consistency
 * scored against the new seed centroid while prompts used old DB content.
 *
 * `makeActive: true` runs demote-v1 + promote-v2 atomically. Mirrors
 * scripts/publish-crisis-resources-v2.ts.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const { db, close } = getDb(config);

  try {
    // Show before state.
    const before = await getActiveLibraryVersions(db);
    console.log(
      `before: voice_rules version=${before.voiceRules.version} hash=${before.voiceRules.hash.slice(0, 12)}`,
    );
    console.log(`seed   : voice_rules hash=${canonicalHash(voiceRulesV1).slice(0, 12)}`);

    const result = await publishLibraryVersion(db, {
      libraryName: 'voice_rules',
      version: 'v2',
      payload: voiceRulesV1,
      publishedBy: 'muhsin:phase-12-promotion-2026-05-06',
      notes:
        'Phase 12 R3 (commit cd0e01b) ratified content: Rule 11 (formatting ' +
        'discipline) added, Rule 10 rewritten to remove bold-encouragement ' +
        'overlap. v1 demoted to active=false. Promoted post-merge after ' +
        'production diagnostic showed seed/DB hash divergence ' +
        '(audit-evidence/phase-12/2026-05-06-phase-12-fallback-diagnostic.md).',
      makeActive: true,
    });

    console.log(
      `voice_rules@v2 hash=${result.hash.slice(0, 12)} active=${result.active} alreadyExisted=${result.alreadyExisted}`,
    );

    resetResolverForTests();
    const after = await getActiveLibraryVersions(db);
    console.log(
      `after  : voice_rules version=${after.voiceRules.version} hash=${after.voiceRules.hash.slice(0, 12)}`,
    );
    verifyIntegrity(after);
    console.log('verifyIntegrity: OK — stored hash matches canonical recomputation.');
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error('voice_rules v2 publish failed:', err);
  process.exit(1);
});
