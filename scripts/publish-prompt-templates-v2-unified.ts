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
 * Publish prompt_templates v3_leadership — SCRUM-50 brand-aligned rewrite.
 *
 * Replaces the v2 "Values-Driven Therapeutic Companion" positioning with
 * "transformational leadership coach" anchored in Hamse Warfa's 12-practice
 * framework. Brand voice: BELONGING / INSPIRING / AUTHENTIC. Brand values:
 * INCLUSION / COMPASSION / INTEGRITY. The embedded §0 Crisis Protocol is
 * deleted — the onboarding AI disclaimer covers legal exposure and §6
 * carries the one-line "not the right help — refer and stop" policy.
 *
 * All five responseMode entries still point to the same systemText. The
 * assembler treats template.id as opaque (the v0 literal-id short-circuit
 * was removed in SCRUM-47) and skips practice / level framing because the
 * seed payload ships them empty.
 *
 * Rollback: republish v2_unified_tune1 with makeActive:true.
 *
 * Why a new version row (not edit-in-place):
 * - Preserves audit trail — turns that ran under previous versions still
 *   resolve their exact prompt for replay
 * - Lets us flip the active pointer in staging first before prod
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
      `seed   : prompt_templates v3_leadership hash=${canonicalHash(promptTemplatesV2Unified).slice(0, 12)}`,
    );

    const result = await publishLibraryVersion(db, {
      libraryName: 'prompt_templates',
      version: 'v3_leadership_tune2_plain_prose',
      payload: promptTemplatesV2Unified,
      publishedBy: 'muhsin:pr-c-voice-markdown-2026-05-23',
      notes:
        'v3_leadership tune2 — adds a §5 non-negotiable instructing the coach to ' +
        'write in plain prose: no markdown emphasis (no *italics* / **bold**), ' +
        'no em dashes (use commas, periods, or paragraph breaks), no bullet lists ' +
        'unless the user asks. Brand-voice polish that stops the coach from ' +
        'reading as generic AI. Rollback: republish v3_leadership_tune1 with ' +
        'makeActive:true.',
      makeActive: true,
    });

    console.log(
      `prompt_templates@v3_leadership hash=${result.hash.slice(0, 12)} active=${result.active} alreadyExisted=${result.alreadyExisted}`,
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
  console.error('prompt_templates v3_leadership publish failed:', err);
  process.exit(1);
});
