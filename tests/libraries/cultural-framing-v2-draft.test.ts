import { describe, expect, it } from 'vitest';
import { culturalFramingV1 } from '../../src/libraries/seed/cultural-framing.js';
import {
  _XIL_FRAMING_DRAFT,
  culturalFramingV2Draft,
} from '../../src/libraries/seed/cultural-framing-v2.js';

/**
 * Phase 11 R40 — cultural_framing v2 DRAFT shape pin.
 *
 * The DRAFT must NOT yet be wired into the live library resolver
 * (CLAUDE.md hard rule #3 — Hamse-owned content). This test only verifies
 * the diff from v1 → v2 is exactly +1 framing (Xil), so a future PR that
 * accidentally edits a v1 framing trips the test.
 */
describe('Phase 11 R40 — cultural_framing v2 DRAFT', () => {
  it('contains exactly v1 framings + 1 new (Xil)', () => {
    expect(culturalFramingV2Draft.framings).toHaveLength(culturalFramingV1.framings.length + 1);
  });

  it('preserves every v1 framing concept name', () => {
    const v1Concepts = culturalFramingV1.framings.map((f) => f.concept);
    const v2Concepts = culturalFramingV2Draft.framings.map((f) => f.concept);
    for (const concept of v1Concepts) {
      expect(v2Concepts).toContain(concept);
    }
  });

  it('adds exactly one new concept: Xil', () => {
    const v1Names = new Set(culturalFramingV1.framings.map((f) => f.concept));
    const newConcepts = culturalFramingV2Draft.framings
      .filter((f) => !v1Names.has(f.concept))
      .map((f) => f.concept);
    expect(newConcepts).toEqual(['Xil']);
  });

  it('Xil framing has gloss + shortDescription + applicableWhen + examplePhrasings', () => {
    expect(_XIL_FRAMING_DRAFT.concept).toBe('Xil');
    expect(_XIL_FRAMING_DRAFT.gloss.length).toBeGreaterThan(10);
    expect(_XIL_FRAMING_DRAFT.shortDescription.length).toBeGreaterThan(50);
    expect(_XIL_FRAMING_DRAFT.applicableWhen.length).toBeGreaterThanOrEqual(2);
    expect(_XIL_FRAMING_DRAFT.examplePhrasings.length).toBeGreaterThanOrEqual(1);
  });

  it('Xil example_phrasings are flagged DRAFT (Hamse review required)', () => {
    // This test should be flipped (or deleted) when Hamse provides final
    // example_phrasings — its purpose is to FAIL once a future PR has
    // shipped real phrasings, signaling it's time to promote v2 → live.
    for (const phrasing of _XIL_FRAMING_DRAFT.examplePhrasings) {
      expect(phrasing).toMatch(/DRAFT/);
    }
  });
});
