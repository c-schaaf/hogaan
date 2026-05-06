import { describe, it, expect } from 'vitest';
import {
  findFramingForPractice,
  selectCulturalFraming,
  buildVoiceRules,
} from '../../src/prompt-assembly/framings.js';
import {
  check5HeroToGuide,
  checkFormattingDiscipline,
} from '../../src/quality-check/checks-rule-based.js';
import {
  checkIntentLength,
  INTENT_LENGTH_BANDS,
} from '../../src/quality-check/intent-length-bands.js';
import { culturalFramingV1 } from '../../src/libraries/seed/cultural-framing.js';
import { voiceRulesV1 } from '../../src/libraries/seed/voice-rules.js';
import { withVoiceFidelityEvidence } from './helpers/evidence-vf.js';

/**
 * Phase 12 Category B — Framing selection (T21–T25), Voice Rule 7 (T26),
 * QC checks (T27–T31), structural Voice Rule proxies (T32–T35).
 *
 * Bucket-1 deterministic where possible. T32, T34 structural-proxy only
 * (semantic LLM-output judgment deferred to voice-smoke).
 *
 * T36 (oversimplification "obviously...") deferred — gated on BPMN
 * decision: new Check 17 vs Check 7 prompt extension. See plan §6 BLOCKERS.
 */
describe('Phase 12 — Category B: Framing & QC (T21–T35)', () => {
  describe('Cultural framing selection (T21–T25)', () => {
    it('T21: accountability practice → Xil framing', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T21-xil-accountability',
          controlId: 'T5.VoiceFidelity.T21_Xil',
          tier: 'T5',
          description:
            'Phase 12 R7 affinity cascade — accountability practice maps to Xil cultural framing (role debt). Selection logic only; framing CONTENT is Hamse-owned (BLOCKED for content review).',
        },
        () => {
          expect(findFramingForPractice(culturalFramingV1, 'accountability')).toBe('Xil');
          const sel = selectCulturalFraming(
            culturalFramingV1,
            'FullCoachingResponse',
            'accountability',
          );
          expect(sel).not.toBeNull();
          expect(sel?.concept).toBe('Xil');
        },
      );
    });

    it('T22: empathy practice → Naxariis framing', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T22-naxariis-empathy',
          controlId: 'T5.VoiceFidelity.T22_Naxariis',
          tier: 'T5',
          description: 'Empathy practice maps to Naxariis (principled mercy) cultural framing.',
        },
        () => {
          expect(findFramingForPractice(culturalFramingV1, 'empathy')).toBe('Naxariis');
        },
      );
    });

    it('T23: humility practice → Geed daad framing', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T23-geed-daad-humility',
          controlId: 'T5.VoiceFidelity.T23_GeedDaad',
          tier: 'T5',
          description: 'Humility practice maps to Geed daad (council tree) cultural framing.',
        },
        () => {
          expect(findFramingForPractice(culturalFramingV1, 'humility')).toBe('Geed daad');
        },
      );
    });

    it('T24: democracy practice → Hooyo framing', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T24-hooyo-democracy',
          controlId: 'T5.VoiceFidelity.T24_Hooyo',
          tier: 'T5',
          description:
            'Democracy practice maps to Hooyo (impartial-listener mother archetype) cultural framing.',
        },
        () => {
          expect(findFramingForPractice(culturalFramingV1, 'democracy')).toBe('Hooyo');
        },
      );
    });

    it('T25: peace practice → Maslaxad framing', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T25-maslaxad-peace',
          controlId: 'T5.VoiceFidelity.T25_Maslaxad',
          tier: 'T5',
          description:
            'Peace practice maps to Maslaxad (deliberate middle-construction) cultural framing.',
        },
        () => {
          expect(findFramingForPractice(culturalFramingV1, 'peace')).toBe('Maslaxad');
        },
      );
    });
  });

  describe('T26 Voice Rule 7 — at most one Somali term per response', () => {
    it('selectCulturalFraming returns at most one concept (Voice Rule 7 selection-time invariant)', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T26-rule7-single-concept',
          controlId: 'T5.VoiceFidelity.T26_Rule7SomaliTerms',
          tier: 'T5',
          description:
            'Voice Rule 7 — selection enforces at most one Somali term per response by returning a single concept. Structural invariant; runtime LLM-output validation deferred to voice-smoke (BLOCKER §6).',
        },
        () => {
          const sel = selectCulturalFraming(
            culturalFramingV1,
            'FullCoachingResponse',
            'accountability',
          );
          expect(sel).not.toBeNull();
          // Single concept name returned, not a list
          expect(typeof sel?.concept).toBe('string');
          expect(sel?.concept.split(',').length).toBe(1);
        },
      );
    });

    it('excluded modes (ClarifyingQuestion / MetaResponse / ProfileUpdateAcknowledgment) return no framing', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T26-excluded-modes-no-framing',
          controlId: 'T5.VoiceFidelity.T26_ExcludedModesNoFraming',
          tier: 'T5',
          description:
            'Voice Rule 7 anti-dilution — terse modes get no Somali term injected. Excludes: ClarifyingQuestion, MetaResponse, ProfileUpdateAcknowledgment.',
        },
        () => {
          expect(
            selectCulturalFraming(culturalFramingV1, 'ClarifyingQuestion', 'accountability'),
          ).toBeNull();
          expect(
            selectCulturalFraming(culturalFramingV1, 'MetaResponse', 'accountability'),
          ).toBeNull();
          expect(
            selectCulturalFraming(
              culturalFramingV1,
              'ProfileUpdateAcknowledgment',
              'accountability',
            ),
          ).toBeNull();
        },
      );
    });
  });

  describe('T27 formatting-discipline (Rule 11)', () => {
    it('checkFormattingDiscipline soft-fails on markdown headers', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T27-formatting-headers',
          controlId: 'T5.VoiceFidelity.T27_FormattingHeaders',
          tier: 'T5',
          description:
            'Voice Rule 11 — WhatsApp-native formatting. Markdown headers (## ...) flagged as soft_fail; QC retry loop fixes.',
        },
        () => {
          const r = checkFormattingDiscipline(
            '## How to give hard feedback\n\nFirst, set the context.\n\nThen, lead with care.',
          );
          expect(r.outcome.status).toBe('soft_fail');
        },
      );
    });

    it('checkFormattingDiscipline passes plain WhatsApp-native text', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T27-formatting-pass',
          controlId: 'T5.VoiceFidelity.T27_FormattingPass',
          tier: 'T5',
          description:
            'Voice Rule 11 — clean prose with at most one *bold* segment passes formatting check.',
        },
        () => {
          const r = checkFormattingDiscipline(
            'When the floor is short, you choose what you can *stake*. Name your stakes to one trusted person this week.',
          );
          expect(r.outcome.status).toBe('pass');
        },
      );
    });
  });

  describe('T29 length-by-intent — Coaching band (R32)', () => {
    it('Coaching intent uses 150–300 word band; in-band passes, out-of-band soft-fails', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T29-coaching-length-band',
          controlId: 'T5.VoiceFidelity.T29_CoachingLengthBand',
          tier: 'T5',
          description:
            'Phase 12 R32 — per-intent length band check. Coaching intent: 150–300 words. Out-of-band yields soft_fail; QC regenerates.',
        },
        () => {
          const band = INTENT_LENGTH_BANDS.Coaching;
          expect(band.min).toBe(150);
          expect(band.max).toBe(300);

          const inBand = 'word '.repeat(200).trim();
          expect(checkIntentLength(inBand, 'Coaching').status).toBe('pass');

          const tooShort = 'word '.repeat(50).trim();
          expect(checkIntentLength(tooShort, 'Coaching').status).toBe('too_short');

          const tooLong = 'word '.repeat(400).trim();
          expect(checkIntentLength(tooLong, 'Coaching').status).toBe('too_long');
        },
      );
    });

    it('Greeting band 10–80 / Affirmation band 5–50 / MetaQuestion band 30–100', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T29-shortcircuit-bands',
          controlId: 'T5.VoiceFidelity.T29_ShortCircuitBands',
          tier: 'T5',
          description:
            'Short-circuit intent bands match plan §2 spec (Greeting 10–80, Affirmation 5–50, MetaQuestion 30–100).',
        },
        () => {
          expect(INTENT_LENGTH_BANDS.Greeting.min).toBe(10);
          expect(INTENT_LENGTH_BANDS.Greeting.max).toBe(80);
          expect(INTENT_LENGTH_BANDS.Affirmation.min).toBe(5);
          expect(INTENT_LENGTH_BANDS.Affirmation.max).toBe(50);
          expect(INTENT_LENGTH_BANDS.MetaQuestion.min).toBe(30);
          expect(INTENT_LENGTH_BANDS.MetaQuestion.max).toBe(100);
        },
      );
    });
  });

  describe('T33 hero-to-guide (Rule 4)', () => {
    it('check5HeroToGuide soft-fails on "I would tell" / "I would do"', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T33-hero-to-guide-i-would',
          controlId: 'T5.VoiceFidelity.T33_HeroToGuide',
          tier: 'T5',
          description:
            'Voice Rule 4 — hero-to-guide. Phrases like "I would tell" / "I would do" indicate the bot is solving for the user, not asking. heroPhraseFlags catches both.',
        },
        () => {
          const r1 = check5HeroToGuide(voiceRulesV1, 'If I were you, I would tell them directly.');
          expect(r1.outcome.status).toBe('soft_fail');

          const r2 = check5HeroToGuide(voiceRulesV1, 'Here is what I would do in your place.');
          expect(r2.outcome.status).toBe('soft_fail');
        },
      );
    });
  });

  describe('T35 warm + pragmatic (Rule 8)', () => {
    it('check5HeroToGuide soft-fails on "you\'ve got this" / "believe in yourself" fluff', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T35-rule8-fluff',
          controlId: 'T5.VoiceFidelity.T35_Rule8Fluff',
          tier: 'T5',
          description:
            'Voice Rule 8 — warm-but-not-fluffy. Motivational fluff phrases ("you\'ve got this", "believe in yourself", "champion") flagged via heroPhraseFlags. Semantic warmth assessment deferred to voice-smoke.',
        },
        () => {
          const r1 = check5HeroToGuide(voiceRulesV1, "You've got this!");
          expect(r1.outcome.status).toBe('soft_fail');

          const r2 = check5HeroToGuide(
            voiceRulesV1,
            'Believe in yourself and the rest will follow.',
          );
          expect(r2.outcome.status).toBe('soft_fail');
        },
      );
    });
  });

  describe('T30 / T31 — covered by existing LLM-mocked tests', () => {
    it.todo(
      'T30: vague "be a better leader" → Check 12 tangible-action soft-fails (covered: tests/quality-check/tangible-action.test.ts)',
    );
    it.todo(
      'T31: name-drop without insight → Check 10 lived-experience score=2 soft-fails (covered: tests/quality-check/lived-experience.test.ts)',
    );
    it.todo(
      'T36: oversimplification "obviously..." → Check 7 tone soft-fail (BLOCKED on BPMN decision: new Check 17 vs Check 7 prompt extension)',
    );
  });

  describe('T32 / T34 structural Voice Rule proxies (semantic deferred to voice-smoke)', () => {
    it('T32: assembled voice-rules block contains Rule 1 (useful-to-society)', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T32-rule1-anchor-block',
          controlId: 'T5.VoiceFidelity.T32_Rule1Anchor',
          tier: 'T5',
          description:
            'Structural proxy for T32 — assembled prompt voice-rules block carries Rule 1. Semantic anchor presence in actual LLM response → voice-smoke.',
        },
        () => {
          const block = buildVoiceRules(voiceRulesV1);
          expect(block).toContain('r1-useful-to-society');
          expect(block.toLowerCase()).toContain('useful to society');
        },
      );
    });

    it('T34: assembled voice-rules block contains Rule 2 (asset-based)', async () => {
      await withVoiceFidelityEvidence(
        {
          testId: 'phase-12/voice-fidelity/T34-rule2-asset-based-block',
          controlId: 'T5.VoiceFidelity.T34_Rule2AssetBased',
          tier: 'T5',
          description:
            'Structural proxy for T34 — assembled prompt voice-rules block carries Rule 2. Semantic asset-based reframe in actual LLM response → voice-smoke.',
        },
        () => {
          const block = buildVoiceRules(voiceRulesV1);
          expect(block).toContain('r2-asset-based');
          expect(block.toLowerCase()).toContain('asset-based');
        },
      );
    });
  });
});
