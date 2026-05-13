import 'dotenv/config';
import {
  canonicalHash,
  getActiveLibraryVersions,
  promptTemplatesV2Unified,
  publishLibraryVersion,
  resetResolverForTests,
  verifyIntegrity,
} from '../src/libraries/index.js';
import { getDb } from '../src/shared/db/client.js';
import { loadConfig } from '../src/shared/secrets/config.js';

/**
 * Publish prompt_templates v2_unified — 2026-05-13 Hamse-ordered overhaul.
 *
 * Replaces the v1 multi-template structure (5 templates + practice framing +
 * level framing) with a single unified system prompt that subsumes all five
 * response modes. The new prompt embeds the Warfa framework lens, the
 * therapeutic toolkit (SFBT default, CBT for stuck beliefs, DBT for high
 * emotion, person-centered always-on), and the turn shape inside its
 * systemText. The assembler short-circuits on template.id === 'coaching_v0_unified'
 * and skips practice framing / level framing / voice rules / cultural framing /
 * directives — those are now baked into the prompt itself.
 *
 * Rollback: re-run with payload = promptTemplatesV1, version = 'v1'. The
 * resolver atomically demotes v2_unified and promotes v1; assembler reverts
 * to legacy multi-block assembly because template.id no longer matches.
 *
 * Why a new version row (not edit-in-place):
 * - Preserves audit trail — turns that ran under v1 still resolve their
 *   exact prompt for replay
 * - Rollback is a one-line script change, no code deploy
 * - Lets us flip the active pointer in staging first before prod
 *
 * Mirrors scripts/publish-voice-rules-v2.ts.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const { db, close } = getDb(config);

  try {
    const before = await getActiveLibraryVersions(db);
    console.log(
      `before: prompt_templates version=${before.promptTemplates.version} hash=${before.promptTemplates.hash.slice(0, 12)}`,
    );
    console.log(
      `seed   : prompt_templates v2_unified hash=${canonicalHash(promptTemplatesV2Unified).slice(0, 12)}`,
    );

    const result = await publishLibraryVersion(db, {
      libraryName: 'prompt_templates',
      version: 'v2_unified',
      payload: promptTemplatesV2Unified,
      publishedBy: 'muhsin:hamse-ordered-overhaul-2026-05-13',
      notes:
        'v2_unified — values-driven companion overhaul ordered by Hamse 2026-05-13 ' +
        'after demo review. One system prompt subsumes all five response modes. ' +
        'Voice content is now the single source of truth; practice framing, level ' +
        'framing, voice rules, and cultural framing are skipped by the assembler ' +
        'when this version is active. Rollback: republish v1 with makeActive:true.',
      makeActive: true,
    });

    console.log(
      `prompt_templates@v2_unified hash=${result.hash.slice(0, 12)} active=${result.active} alreadyExisted=${result.alreadyExisted}`,
    );

    resetResolverForTests();
    const after = await getActiveLibraryVersions(db);
    console.log(
      `after  : prompt_templates version=${after.promptTemplates.version} hash=${after.promptTemplates.hash.slice(0, 12)}`,
    );
    verifyIntegrity(after);
    console.log('verifyIntegrity: OK — stored hash matches canonical recomputation.');
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error('prompt_templates v2_unified publish failed:', err);
  process.exit(1);
});
