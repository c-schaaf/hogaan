import { describe, expect, it } from 'vitest';
import { tagPracticeAndLevel } from '../../src/coaching/tagger.js';

/**
 * Phase 11 R17 — tagger now emits primary + secondary + confidence.
 *
 * The audit found the v1 tagger silently coerced low-confidence inputs to
 * 'integrity' default with no flag. Reviewers had no signal to triage
 * borderline tags. v2 surfaces:
 *   - secondaryPracticeTag / secondaryLevelTag — runner-up if any
 *   - confidence ∈ [0, 1]; review queue threshold is 0.6
 */

describe('Phase 11 R17 — tagger secondary + confidence', () => {
  it('high-hit message keyword → confidence ≥ 0.6 (no review queue)', () => {
    const result = tagPracticeAndLevel(
      'I want to compromise my integrity to win this deal — my principles say no',
    );
    expect(result.tagSource).toBe('message');
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result.practiceTag).toBe('integrity');
  });

  it('multiple practices in same message → secondary is the runner-up', () => {
    // "humility" + "wrong" both fire humility hits; "feud" fires peace hits.
    // Message hits humility=2 (humble + wrong), peace=1 (feud) — primary humility,
    // secondary peace.
    const result = tagPracticeAndLevel(
      'I am humble enough to admit I was wrong but the feud with that team continues',
    );
    expect(result.practiceTag).toBe('humility');
    expect(result.secondaryPracticeTag).toBe('peace');
  });

  it('single-keyword message → secondary is null', () => {
    const result = tagPracticeAndLevel('integrity');
    expect(result.practiceTag).toBe('integrity');
    expect(result.secondaryPracticeTag).toBeNull();
  });

  it('profile fallback → confidence 0.4 (review queue territory)', () => {
    const result = tagPracticeAndLevel('hello there', ['dignity']);
    expect(result.tagSource).toBe('profile');
    expect(result.confidence).toBeCloseTo(0.4, 5);
    expect(result.confidence).toBeLessThan(0.6);
  });

  it('hard fallback (no hits, empty profile) → confidence 0.1 (review queue)', () => {
    const result = tagPracticeAndLevel('hello there');
    expect(result.tagSource).toBe('fallback');
    expect(result.confidence).toBeCloseTo(0.1, 5);
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.practiceTag).toBe('integrity'); // safe default still
  });

  it('level scoring: clear team-level message picks team', () => {
    const result = tagPracticeAndLevel('my team is struggling with conflict and tension');
    expect(result.levelTag).toBe('team');
  });

  it('level secondary: when both team and self are referenced', () => {
    // "my team" → team=1; "my own" → self=1; team wins by tiebreak (iter order),
    // self should be secondary.
    const result = tagPracticeAndLevel('my team needs my own steady presence');
    // Either team or self could win depending on iteration order; the contract
    // is that the loser shows up as secondaryLevelTag.
    expect([result.levelTag, result.secondaryLevelTag]).toEqual(
      expect.arrayContaining(['team', 'self']),
    );
  });

  it('confidence increases with more keyword hits', () => {
    const oneHit = tagPracticeAndLevel('integrity');
    const threeHits = tagPracticeAndLevel('integrity principles compromise my standards');
    expect(threeHits.confidence).toBeGreaterThan(oneHit.confidence);
  });
});
