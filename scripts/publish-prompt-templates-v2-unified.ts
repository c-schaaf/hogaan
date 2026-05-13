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
      version: 'v2_unified_tune1',
      payload: promptTemplatesV2Unified,
      publishedBy: 'muhsin:audit-driven-tune-2026-05-13',
      notes:
        'v2_unified — values-driven companion. Original overhaul ordered by Hamse ' +
        '2026-05-13 after demo review; subsequent same-day tune driven by Chunk-1 ' +
        'coaching-quality audit. Tune targets three failure modes the audit found: ' +
        '(1) reflexive question-ending (27/30 turns ended on a question) — §5 now ' +
        'permits and encourages landing a take and stopping; (2) multi-option ' +
        'menus and stacked questions (18/30 turns) — §6 explicitly bans both; ' +
        '(3) refusing to give a draft when the user asks for one (S8 canonical ' +
        'failure) — §2 and §6 now require giving 1–3 line drafts on request. ' +
        'Also adds context-carry preamble to §5 and two new example exchanges ' +
        '(Ex 5: draft-on-request, Ex 6: land-and-stop). Rollback: republish v1 ' +
        'with makeActive:true.',
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
