import { describe, expect, it } from 'vitest';
import { checkFormattingDiscipline } from '../../src/quality-check/checks-rule-based.js';
import { voiceRulesV1 } from '../../src/libraries/seed/voice-rules.js';
import {
  _R11_FORMATTING_DRAFT,
  voiceRulesV2Draft,
} from '../../src/libraries/seed/voice-rules-v2.js';

/**
 * Phase 11 R39 — Rule 11 (formatting discipline) wiring.
 *
 * Two surfaces:
 *   1. Rule-based check (checkFormattingDiscipline) — runtime enforcement.
 *   2. Voice rules v2 DRAFT — content statement that the LLM and the QC
 *      voice-consistency check (R15) read.
 */

describe('Phase 11 R39 — checkFormattingDiscipline (runtime)', () => {
  it('passes a clean WhatsApp-native response (one bold, no headers, no bullets)', () => {
    const text = `Your sleeplessness is integrity working. *That is the leadership instinct talking.* The next move is to name what your team needs from you in the next 48 hours.`;
    const r = checkFormattingDiscipline(text);
    expect(r.checkId).toBe('check_11_formatting_discipline');
    expect(r.outcome.status).toBe('pass');
  });

  it('passes plain text with zero formatting', () => {
    const text = `Plain prose. Two sentences. No markdown anywhere.`;
    expect(checkFormattingDiscipline(text).outcome.status).toBe('pass');
  });

  it('soft-fails on markdown headers', () => {
    const text = `## Diagnosis\nYour situation is complex.`;
    const r = checkFormattingDiscipline(text);
    expect(r.outcome.status).toBe('soft_fail');
    if (r.outcome.status === 'soft_fail') {
      expect(r.outcome.reason).toMatch(/markdown header/);
    }
  });

  it('soft-fails when more than one bold segment is used', () => {
    const text = `*One.* *Two.* *Three.*`;
    const r = checkFormattingDiscipline(text);
    expect(r.outcome.status).toBe('soft_fail');
    if (r.outcome.status === 'soft_fail') {
      expect(r.outcome.reason).toMatch(/3 bold segment/);
    }
  });

  it('soft-fails on bullet-list lines (- prefix)', () => {
    const text = `Here are three things:\n- first\n- second\n- third`;
    const r = checkFormattingDiscipline(text);
    expect(r.outcome.status).toBe('soft_fail');
    if (r.outcome.status === 'soft_fail') {
      expect(r.outcome.reason).toMatch(/bullet-list/);
    }
  });

  it('soft-fails on bullet-list lines (* prefix)', () => {
    const text = `Things:\n* alpha\n* beta`;
    expect(checkFormattingDiscipline(text).outcome.status).toBe('soft_fail');
  });

  it('reports all violations on a kitchen-sink failure', () => {
    const text = `## Header\n**Bold one** and **bold two**.\n- bullet\n- bullet`;
    const r = checkFormattingDiscipline(text);
    expect(r.outcome.status).toBe('soft_fail');
    if (r.outcome.status === 'soft_fail') {
      expect(r.outcome.reason).toMatch(/header/);
      expect(r.outcome.reason).toMatch(/bold/);
      expect(r.outcome.reason).toMatch(/bullet/);
    }
  });
});

describe('Phase 11 R39 — voice_rules v2 DRAFT shape', () => {
  it('contains exactly v1 rules + 1 (r11-formatting-discipline)', () => {
    expect(voiceRulesV2Draft.rules).toHaveLength(voiceRulesV1.rules.length + 1);
  });

  it('preserves every v1 rule id', () => {
    const v1Ids = voiceRulesV1.rules.map((r) => r.id);
    const v2Ids = voiceRulesV2Draft.rules.map((r) => r.id);
    for (const id of v1Ids) {
      expect(v2Ids).toContain(id);
    }
  });

  it('rule 11 has id r11-formatting-discipline and DRAFT examples', () => {
    expect(_R11_FORMATTING_DRAFT.id).toBe('r11-formatting-discipline');
    for (const ex of _R11_FORMATTING_DRAFT.positiveExamples) {
      expect(ex).toMatch(/DRAFT/);
    }
    for (const ex of _R11_FORMATTING_DRAFT.negativeExamples) {
      expect(ex).toMatch(/DRAFT/);
    }
  });
});
