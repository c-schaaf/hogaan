import { describe, expect, it } from 'vitest';
import { culturalFramingV1, promptTemplatesV1, voiceRulesV1 } from '../../src/libraries/index.js';
import {
  selectCulturalFraming,
  selectSystemTemplate,
  validateInputPayload,
  PromptAssemblyError,
} from '../../src/prompt-assembly/index.js';
import type { InputPayload } from '../../src/prompt-assembly/index.js';
import { _practiceToFraming } from '../../src/prompt-assembly/framings.js';
import { PRACTICE_TAGS } from '../../src/shared/types/index.js';

const baseFullCoaching: InputPayload = {
  responseMode: 'FullCoachingResponse',
  practiceTag: 'integrity',
  levelTag: 'self',
  userMessage: 'How do I keep my team together?',
  userProfile: { role: 'Professional', isDiaspora: false },
  retrievedMemories: [],
  sessionTurns: [],
};

// Customer-feedback PR3 — coaching_main forbids clarifier-only first turns.
// Customer reported the bot opened with multi-part clarifying questions
// instead of substantive coaching. Step 7 (clarification gate) is a no-op
// in v1; this PR is a prompt-only fix that requires Insight + Action even
// on broad input.
describe('customer-feedback PR3 — coaching_main substantive-first directive', () => {
  const coachingMain = promptTemplatesV1.templates.find(
    (t) => t.responseMode === 'FullCoachingResponse',
  );

  it('exists in the seed', () => {
    expect(coachingMain).toBeDefined();
  });

  it('forbids clarifier-only responses on first turn', () => {
    const t = coachingMain!.systemText.toLowerCase();
    expect(t).toContain('clarifying question');
    // Either explicitly says never-only-clarifier OR requires insight+action together.
    expect(t).toMatch(
      /never respond with a clarifying question alone|always include insight and action/,
    );
  });

  it('still requires Insight and Action on broad input', () => {
    const t = coachingMain!.systemText;
    expect(t).toMatch(/Insight/);
    expect(t).toMatch(/Action/);
  });

  it('retains the crisis-handling directive (regression guard)', () => {
    const t = coachingMain!.systemText.toLowerCase();
    expect(t).toContain('crisis');
    expect(t).toMatch(/self-harm|imminent danger|crisis subprocess/);
  });
});

// Follow-up to PR4 — coaching_main reads the Experience band and calibrates
// depth/tone per band. The buildUserProfileBlock already emits an Experience
// line; this directive tells the LLM what to do with it.
describe('coaching_main experience-band calibration', () => {
  const coachingMain = promptTemplatesV1.templates.find(
    (t) => t.responseMode === 'FullCoachingResponse',
  );

  it('references each of the three bands by their prose labels', () => {
    const t = coachingMain!.systemText;
    expect(t).toContain('Less than 5 years');
    expect(t).toContain('5 to 10 years');
    expect(t).toContain('Over 10 years');
  });

  it('tells the LLM how to calibrate depth per band', () => {
    const t = coachingMain!.systemText.toLowerCase();
    expect(t).toContain('experience-band calibration');
    // Foundational/first-time signal for <5
    expect(t).toMatch(/foundational|first.time|new manager/);
    // Peer-tone signal for 5-10
    expect(t).toMatch(/peer|manager.of.managers/);
    // Exec signal for 10+
    expect(t).toMatch(/executive|exec|founder/);
  });

  it('handles the missing-band fallback explicitly', () => {
    const t = coachingMain!.systemText.toLowerCase();
    expect(t).toMatch(/legacy|absent|fall back|fallback/);
  });
});

describe('validateInputPayload', () => {
  it('accepts a well-formed FullCoachingResponse payload', () => {
    expect(() => validateInputPayload(baseFullCoaching)).not.toThrow();
  });

  it('rejects empty userMessage', () => {
    expect(() => validateInputPayload({ ...baseFullCoaching, userMessage: '' })).toThrow(
      PromptAssemblyError,
    );
  });

  // practiceTag enforcement removed 2026-05-13 (coaching_v0_unified short-circuits
  // the practice framing block; tagger is also stubbed). Tag is informational only.
  it.skip('requires practiceTag for FullCoachingResponse', () => {
    const bad = { ...baseFullCoaching, practiceTag: undefined } as unknown as InputPayload;
    expect(() => validateInputPayload(bad)).toThrow(PromptAssemblyError);
  });

  it('does NOT require tags for ClarifyingQuestion', () => {
    const ok: InputPayload = {
      responseMode: 'ClarifyingQuestion',
      userMessage: 'help',
      userProfile: {},
      retrievedMemories: [],
      sessionTurns: [],
    };
    expect(() => validateInputPayload(ok)).not.toThrow();
  });

  // practiceTag enforcement removed 2026-05-13 — unknown values now pass through.
  it.skip('rejects unknown practiceTag', () => {
    const bad = { ...baseFullCoaching, practiceTag: 'fortitude' } as unknown as InputPayload;
    expect(() => validateInputPayload(bad)).toThrow(PromptAssemblyError);
  });
});

describe('selectSystemTemplate', () => {
  it('finds a template per response mode', () => {
    const r = selectSystemTemplate(promptTemplatesV1, 'FullCoachingResponse');
    expect(r.id).toBe('coaching_main_v3');
    expect(r.tokenBudget).toBeGreaterThan(0);
  });

  it('throws E8 for a mode with no template', () => {
    const stripped = {
      ...promptTemplatesV1,
      templates: promptTemplatesV1.templates.filter((t) => t.responseMode !== 'MetaResponse'),
    };
    expect(() => selectSystemTemplate(stripped, 'MetaResponse')).toThrow(PromptAssemblyError);
  });
});

describe('selectCulturalFraming', () => {
  it('returns a framing for FullCoachingResponse with a known practice (Phase 12 R7-9: integrity → Wadanjirka)', () => {
    const r = selectCulturalFraming(culturalFramingV1, 'FullCoachingResponse', 'integrity');
    expect(r).not.toBeNull();
    expect(r?.concept).toBe('Wadanjirka');
    expect(r?.text).toContain('Wadanjirka');
  });

  it('returns null for ClarifyingQuestion', () => {
    expect(selectCulturalFraming(culturalFramingV1, 'ClarifyingQuestion', 'integrity')).toBeNull();
  });

  it('returns null for MetaResponse', () => {
    expect(selectCulturalFraming(culturalFramingV1, 'MetaResponse', 'integrity')).toBeNull();
  });

  it('returns null for ProfileUpdateAcknowledgment', () => {
    expect(
      selectCulturalFraming(culturalFramingV1, 'ProfileUpdateAcknowledgment', 'integrity'),
    ).toBeNull();
  });

  it('every practice maps to a framing concept that exists in cultural_framing v1', () => {
    for (const p of PRACTICE_TAGS) {
      const concept = _practiceToFraming[p];
      expect(culturalFramingV1.framings.find((f) => f.concept === concept)).toBeDefined();
    }
  });

  it('voice_rules v1 anchor patterns are non-empty (Process #10 Check 6 dependency)', () => {
    expect(voiceRulesV1.usefulToSocietyPatterns.length).toBeGreaterThan(0);
  });
});

// Customer-feedback PR4 — user-profile block prefers experienceBand over role.
import { buildUserProfileBlock } from '../../src/prompt-assembly/blocks.js';

describe('customer-feedback PR4 — buildUserProfileBlock prefers experienceBand', () => {
  it('emits Experience and omits Role when experienceBand is present', () => {
    const block = buildUserProfileBlock({
      role: 'Leader',
      experienceBand: '5-10',
      isDiaspora: false,
    });
    expect(block).toContain('Experience: 5-10 years');
    expect(block).not.toContain('Role: Leader');
  });

  it('falls back to Role when no experienceBand is present', () => {
    const block = buildUserProfileBlock({ role: 'Leader', isDiaspora: false });
    expect(block).toContain('Role: Leader');
    expect(block).not.toContain('Experience:');
  });

  it('renders <5 band as "Less than 5 years" prose form', () => {
    const block = buildUserProfileBlock({ experienceBand: '<5', isDiaspora: false });
    expect(block).toContain('Experience: Less than 5 years');
  });

  it('renders 10+ band as "Over 10 years" prose form', () => {
    const block = buildUserProfileBlock({ experienceBand: '10+', isDiaspora: false });
    expect(block).toContain('Experience: Over 10 years');
  });
});
