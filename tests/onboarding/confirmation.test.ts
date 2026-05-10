import { describe, expect, it } from 'vitest';
import {
  practiceNamesEchoed,
  synthesizeProfileSummary,
  templatedFallback,
} from '../../src/onboarding/confirmation.js';
import { promptTemplatesV1 } from '../../src/libraries/index.js';

/**
 * Customer-feedback PR2 — confirmation echoes selected practice names verbatim.
 *
 * Customer reported the confirmation ("Got it. You're focused on Leadership
 * confidence, Communications...") used generic categories instead of the 12
 * practice names. Two layers of defense:
 *  1. Tighten profile_ack_v1 system prompt to forbid renaming practices.
 *  2. Deterministic post-QC guard — if user picked ≥1 practice and none
 *     appear in the LLM output, fall back to templated text.
 */

const ALL_PRACTICES = [
  'integrity',
  'purpose',
  'accountability',
  'dignity',
  'empathy',
  'inclusion',
  'assets',
  'innovation',
  'prosperity',
  'humility',
  'democracy',
  'peace',
] as const;

describe('customer-feedback PR2 — profile_ack_v1 prompt content', () => {
  const profileAck = promptTemplatesV1.templates.find((t) => t.id === 'profile_ack_v1');

  it('exists in the seed', () => {
    expect(profileAck).toBeDefined();
  });

  it('forbids paraphrasing user-selected practice names', () => {
    expect(profileAck!.systemText.toLowerCase()).toContain('verbatim');
  });

  it('mentions the practice-name discipline (no rename to generic categories)', () => {
    const t = profileAck!.systemText.toLowerCase();
    expect(t).toMatch(/practice|integrity|peace/);
    expect(t).toMatch(/do not (rename|paraphrase|substitute)/);
  });
});

describe('customer-feedback PR2 — synthesizeProfileSummary', () => {
  it('surfaces practice names as quoted tokens with verbatim instruction', () => {
    const out = synthesizeProfileSummary({
      role: 'Professional',
      goals: ['integrity', 'peace'],
      location: 'Mogadishu',
    });
    expect(out).toContain('"integrity"');
    expect(out).toContain('"peace"');
    expect(out.toLowerCase()).toContain('exact');
  });

  it('still functions when goals is null/empty (legacy paths)', () => {
    const out = synthesizeProfileSummary({ role: null, goals: null, location: null });
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('customer-feedback PR2 — templatedFallback echoes practice names verbatim', () => {
  for (const practice of ALL_PRACTICES) {
    it(`fallback contains "${practice}" verbatim when goals=[${practice}]`, () => {
      const out = templatedFallback({ role: 'Leader', goals: [practice], location: null });
      expect(out.toLowerCase()).toContain(practice);
    });
  }
});

describe('customer-feedback PR2 — practiceNamesEchoed guard', () => {
  it('returns true when at least one selected practice appears in the candidate', () => {
    expect(
      practiceNamesEchoed('You named integrity and peace — I hear you.', ['integrity', 'peace']),
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(practiceNamesEchoed('Focused on INTEGRITY this week.', ['integrity'])).toBe(true);
  });

  it('returns false when the LLM substitutes generic categories', () => {
    expect(
      practiceNamesEchoed(
        'You are focused on leadership confidence and communication.',
        ['integrity', 'peace'],
      ),
    ).toBe(false);
  });

  it('returns true when goals is empty/undefined (no constraint to enforce)', () => {
    expect(practiceNamesEchoed('any text here', [])).toBe(true);
    expect(practiceNamesEchoed('any text here', undefined)).toBe(true);
  });

  it('matches whole-word — does not pass on substring like "integrityX"', () => {
    expect(practiceNamesEchoed('the disintegrityX of the team', ['integrity'])).toBe(false);
  });
});
