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

describe('validateInputPayload', () => {
  it('accepts a well-formed FullCoachingResponse payload', () => {
    expect(() => validateInputPayload(baseFullCoaching)).not.toThrow();
  });

  it('rejects empty userMessage', () => {
    expect(() => validateInputPayload({ ...baseFullCoaching, userMessage: '' })).toThrow(
      PromptAssemblyError,
    );
  });

  it('requires practiceTag for FullCoachingResponse', () => {
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

  it('rejects unknown practiceTag', () => {
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
