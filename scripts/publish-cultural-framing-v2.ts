import 'dotenv/config';
import {
  canonicalHash,
  culturalFramingV1,
  getActiveLibraryVersions,
  publishLibraryVersion,
  resetResolverForTests,
  verifyIntegrity,
} from '../src/libraries/index.js';
import { getDb } from '../src/shared/db/client.js';
import { loadConfig } from '../src/shared/secrets/config.js';

/**
 * Publish cultural_framing v2 — Phase 12 R7+R8+R9 ratified content
 * (Xil added with applicableWhen + examplePhrasings, Hooyo description
 * rewritten for democracy, practicesMapped populated per audit cascade).
 *
 * The existing seed export `culturalFramingV1` carries the post-Phase-12
 * content (the v2 file was inlined into v1 by commits e72844a + e76385b).
 * This script promotes that content as version='v2' in the DB so prompt
 * assembly resolves the new content.
 *
 * Background: 2026-05-06 production diagnostic
 * (audit-evidence/phase-12/2026-05-06-phase-12-fallback-diagnostic.md)
 * found the active v1 row was the pre-Phase-12 hash. Promoting v2 closes
 * the prompt-vs-checks content split.
 *
 * `makeActive: true` runs demote-v1 + promote-v2 atomically. Mirrors
 * scripts/publish-crisis-resources-v2.ts.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const { db, close } = getDb(config);

  try {
    const before = await getActiveLibraryVersions(db);
    console.log(
      `before: cultural_framing version=${before.culturalFraming.version} hash=${before.culturalFraming.hash.slice(0, 12)}`,
    );
    console.log(`seed   : cultural_framing hash=${canonicalHash(culturalFramingV1).slice(0, 12)}`);

    const result = await publishLibraryVersion(db, {
      libraryName: 'cultural_framing',
      version: 'v2',
      payload: culturalFramingV1,
      publishedBy: 'muhsin:phase-12-promotion-2026-05-06',
      notes:
        'Phase 12 R7+R8+R9 (commit e72844a) and Group I (e76385b) ratified ' +
        'content: Xil framing added with applicableWhen + examplePhrasings, ' +
        'Hooyo description rewritten for democracy practice, practicesMapped ' +
        'populated on every framing per audit cascade. v1 demoted to ' +
        'active=false. Promoted post-merge after production diagnostic ' +
        '(audit-evidence/phase-12/2026-05-06-phase-12-fallback-diagnostic.md).',
      makeActive: true,
    });

    console.log(
      `cultural_framing@v2 hash=${result.hash.slice(0, 12)} active=${result.active} alreadyExisted=${result.alreadyExisted}`,
    );

    resetResolverForTests();
    const after = await getActiveLibraryVersions(db);
    console.log(
      `after  : cultural_framing version=${after.culturalFraming.version} hash=${after.culturalFraming.hash.slice(0, 12)}`,
    );
    verifyIntegrity(after);
    console.log('verifyIntegrity: OK — stored hash matches canonical recomputation.');
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error('cultural_framing v2 publish failed:', err);
  process.exit(1);
});
