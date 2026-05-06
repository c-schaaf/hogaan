import { describe, it, expect } from 'vitest';
import { _internal as orchestratorInternal } from '../../src/coaching/orchestrator.js';
import { BRAND_FRAMEWORK_ATTRIBUTION } from '../../src/shared/brand/constants.js';
import { parsePractices, parseRole } from '../../src/onboarding/parsers.js';
import { withVoiceFidelityEvidence } from './helpers/evidence-vf.js';

const { GREETING_RESPONSE, AFFIRMATION_RESPONSE, META_TEMPLATE } = orchestratorInternal;

function wordCount(s: string): number {
  return s
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0).length;
}

describe('Phase 12 — Category D: Lifecycle (T46–T50)', () => {
  describe('T46 greeting short-circuit', () => {
    it('GREETING_RESPONSE template within 10–80 word band', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T46-greeting-template',
          controlId: 'T5.VoiceFidelity.T46_GreetingTemplate',
          tier: 'T5',
          description:
            '"Salaam" routes to GREETING_RESPONSE short-circuit (no LLM, no QC). Word-count must satisfy R20/R21 Greeting band 10–80 words.',
        },
        () => {
          const w = wordCount(GREETING_RESPONSE);
          expect(w).toBeGreaterThanOrEqual(10);
          expect(w).toBeLessThanOrEqual(80);
          expect(GREETING_RESPONSE.toLowerCase()).toContain('hogaan');
        },
      );
    });
  });

  describe('T47 affirmation short-circuit', () => {
    it('AFFIRMATION_RESPONSE template within 5–50 word band', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T47-affirmation-template',
          controlId: 'T5.VoiceFidelity.T47_AffirmationTemplate',
          tier: 'T5',
          description:
            '"Thanks, that helps" affirmation short-circuit returns AFFIRMATION_RESPONSE. Word-count satisfies R20/R21 Affirmation band 5–50 words. Note: orchestrator routing precedence between Affirmation intent and continuation-close (R22) is documented in plan §3 Phase G.',
        },
        () => {
          const w = wordCount(AFFIRMATION_RESPONSE);
          expect(w).toBeGreaterThanOrEqual(5);
          expect(w).toBeLessThanOrEqual(50);
        },
      );
    });
  });

  describe('T48 meta-question short-circuit', () => {
    it('META_TEMPLATE within 30–100 word band and contains BRAND_FRAMEWORK_ATTRIBUTION token', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T48-meta-template',
          controlId: 'T5.VoiceFidelity.T48_MetaTemplate',
          tier: 'T5',
          description:
            '"Are you AI?" routes to META_TEMPLATE. Word-count in MetaQuestion band 30–100 (R32). Must include BRAND_FRAMEWORK_ATTRIBUTION canonical token (R36) — never ad-hoc framework wording. Voice Rule 11 formatting-discipline: no markdown headers, no bullets.',
        },
        () => {
          const w = wordCount(META_TEMPLATE);
          expect(w).toBeGreaterThanOrEqual(30);
          expect(w).toBeLessThanOrEqual(100);
          expect(META_TEMPLATE).toContain(BRAND_FRAMEWORK_ATTRIBUTION);
          // Voice Rule 11 — formatting discipline
          expect(META_TEMPLATE).not.toMatch(/^#{1,6}\s/m);
          expect(META_TEMPLATE).not.toMatch(/^\s*[-*]\s/m);
        },
      );
    });
  });

  describe('T49 12-practice picker (R14)', () => {
    it('parsePractices accepts "humility, peace" / "ALL" / "self"', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T49-practice-picker',
          controlId: 'T5.VoiceFidelity.T49_PracticePicker',
          tier: 'T5',
          description:
            'Phase 12 R14 — onboarding goal step parses 12-practice picker. Multi-practice ("humility, peace") and "ALL" and level shorthand ("self") all valid.',
        },
        () => {
          const r1 = parsePractices('humility, peace');
          expect(r1).not.toBe('invalid');
          if (r1 !== 'invalid') {
            expect(r1.practices).toEqual(expect.arrayContaining(['humility', 'peace']));
            expect(r1.practices).toHaveLength(2);
          }

          const r2 = parsePractices('ALL');
          expect(r2).not.toBe('invalid');
          if (r2 !== 'invalid') {
            expect(r2.matchedAll).toBe(true);
            expect(r2.practices).toHaveLength(12);
          }

          const r3 = parsePractices('self');
          expect(r3).not.toBe('invalid');
          if (r3 !== 'invalid') {
            expect(r3.practices).toEqual(
              expect.arrayContaining(['integrity', 'purpose', 'accountability']),
            );
            expect(r3.practices).toHaveLength(3);
          }
        },
      );
    });
  });

  describe('T50 role taxonomy (R15)', () => {
    it('parseRole maps "advocate" → Advocate; "community organizer" → CommunityLeader', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T50-role-taxonomy',
          controlId: 'T5.VoiceFidelity.T50_RoleTaxonomy',
          tier: 'T5',
          description:
            'Phase 12 R15 — 5-role taxonomy (Student/Professional/Leader/CommunityLeader/Advocate). Order matters: CommunityLeader > Advocate > Leader > Student > Professional, so "community organizer" hits CommunityLeader before "advocate" can match.',
        },
        () => {
          expect(parseRole('advocate')).toBe('Advocate');
          expect(parseRole('Advocate')).toBe('Advocate');
          expect(parseRole('community organizer')).toBe('CommunityLeader');
          expect(parseRole('community leader')).toBe('CommunityLeader');
          expect(parseRole('civic leader')).toBe('CommunityLeader');
        },
      );
    });
  });
});
