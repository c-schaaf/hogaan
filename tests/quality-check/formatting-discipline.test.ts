import { describe, expect, it } from 'vitest';
import { checkFormattingDiscipline } from '../../src/quality-check/checks-rule-based.js';
import { voiceRulesV1 } from '../../src/libraries/seed/voice-rules.js';

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

describe('Phase 12 R3 — voice_rules v2 promoted (Rule 11 in v1 active)', () => {
  it('v1 contains 11 rules including r11-formatting-discipline', () => {
    expect(voiceRulesV1.rules).toHaveLength(11);
    expect(voiceRulesV1.rules.find((r) => r.id === 'r11-formatting-discipline')).toBeDefined();
  });

  it('Rule 11 has ratified positive/negative examples (no DRAFT markers)', () => {
    const r11 = voiceRulesV1.rules.find((r) => r.id === 'r11-formatting-discipline');
    expect(r11).toBeDefined();
    if (r11 === undefined) return;
    for (const ex of r11.positiveExamples) {
      expect(ex).not.toMatch(/DRAFT/);
    }
    for (const ex of r11.negativeExamples) {
      expect(ex).not.toMatch(/DRAFT/);
    }
  });

  it('Rule 10 description no longer mentions bold; cross-references Rule 11', () => {
    const r10 = voiceRulesV1.rules.find((r) => r.id === 'r10-respect-time');
    expect(r10).toBeDefined();
    if (r10 === undefined) return;
    expect(r10.description).not.toMatch(/\bbold\b/i);
    expect(r10.description).toMatch(/Rule 11/);
  });
});
