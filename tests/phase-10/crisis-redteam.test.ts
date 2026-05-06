import { describe, expect, it } from 'vitest';
import { fastPathTriage } from '../../src/coaching/triage.js';
import { recordEvidence } from '../../src/shared/audit-evidence/index.js';
import { withEvidence } from './helpers/evidence.js';
import { TIER_A_PHRASES, TIER_B_PHRASES } from './crisis-redteam.fixtures.js';

/**
 * Phase 10.3 — crisis red-team test corpus.
 *
 * Hard rule: zero false negatives across the Tier A corpus. If any phrase
 * here ever fails to route to crisis, the coaching pipeline is unsafe to
 * ship. CLAUDE.md hard rule #1.
 *
 * Each Tier A phrase produces an audit evidence row tagged
 * T3.CrisisHandling.<category>.
 *
 * Tier B phrases are recorded as `outcome: 'deferred'` because they
 * require a real LLM round-trip (Groq first-line OR Process #10 §Check 8
 * second-line) and aren't deterministic in unit-test CI. They're
 * verified live during the Phase A pre-launch smoke run.
 */

describe('Phase 10.3 — Crisis red-team Tier A (sync keyword fast-path)', () => {
  for (const phrase of TIER_A_PHRASES) {
    it(`detects crisis: [${phrase.category}] "${phrase.message.slice(0, 60)}${phrase.message.length > 60 ? '…' : ''}"`, async () => {
      await withEvidence(
        {
          testId: `phase-10/crisis-redteam/${phrase.id}`,
          controlId: `T3.CrisisHandling.${phrase.category}`,
          tier: 'T3',
          description: `Tier A: synchronous keyword fast-path classifies "${phrase.message}" as crisis`,
          details: { phraseId: phrase.id, category: phrase.category, message: phrase.message },
        },
        () => {
          const result = fastPathTriage(phrase.message, []);
          expect(
            result,
            'fastPathTriage returned null — phrase did not match the keyword corpus',
          ).not.toBeNull();
          expect(result?.status).toBe('crisis');
        },
      );
    });
  }

  it('corpus size meets the ≥50 phrase floor', async () => {
    await withEvidence(
      {
        testId: 'phase-10/crisis-redteam/corpus-size',
        controlId: 'T3.CrisisHandling.CorpusSize',
        tier: 'T3',
        description: 'Tier A corpus has at least 50 phrases',
        details: { tierACount: TIER_A_PHRASES.length, tierBCount: TIER_B_PHRASES.length },
      },
      () => {
        expect(TIER_A_PHRASES.length).toBeGreaterThanOrEqual(50);
      },
    );
  });

  it('all categories represented (≥1 phrase per category in Tier A)', async () => {
    await withEvidence(
      {
        testId: 'phase-10/crisis-redteam/category-coverage',
        controlId: 'T3.CrisisHandling.CategoryCoverage',
        tier: 'T3',
        description: 'Each Tier A category is represented by at least one phrase',
      },
      () => {
        const categories = new Set(TIER_A_PHRASES.map((p) => p.category));
        // Hopelessness_Indirect is intentionally Tier B only.
        expect(categories.has('SuicidalIdeation_Direct')).toBe(true);
        expect(categories.has('SuicidalIdeation_Method')).toBe(true);
        expect(categories.has('SuicidalIdeation_Passive')).toBe(true);
        expect(categories.has('SelfHarm_Direct')).toBe(true);
        expect(categories.has('AbuseDisclosure_Physical')).toBe(true);
        expect(categories.has('AbuseDisclosure_Sexual')).toBe(true);
        expect(categories.has('ImminentDanger_Other')).toBe(true);
      },
    );
  });
});

describe('Phase 10.3 — Crisis red-team Tier B (LLM-required, deferred)', () => {
  it('records each Tier B phrase as deferred-pending-live-verification', async () => {
    // Tier B verification happens live in the Phase A pre-launch smoke
    // run (a real Groq+QC round trip per phrase). Here we just record the
    // intent so the audit binder shows the phrases exist in the corpus.
    for (const phrase of TIER_B_PHRASES) {
      await recordEvidence({
        testId: `phase-10/crisis-redteam/${phrase.id}`,
        controlId: `T3.CrisisHandling.${phrase.category}`,
        tier: 'T3',
        outcome: 'deferred',
        description: `Tier B: indirect phrase "${phrase.message}" — verification deferred to live LLM round-trip in Phase A smoke run`,
        details: { phraseId: phrase.id, category: phrase.category, message: phrase.message },
      });
    }
    expect(TIER_B_PHRASES.length).toBeGreaterThanOrEqual(10);
  });
});
