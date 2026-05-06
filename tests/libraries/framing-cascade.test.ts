import { describe, expect, it } from 'vitest';
import { findFramingForPractice } from '../../src/prompt-assembly/framings.js';
import { culturalFramingV1 } from '../../src/libraries/seed/cultural-framing.js';
import type { PracticeTag } from '../../src/shared/types/index.js';

/**
 * Phase 12 R7+R8+R9 — affinity cascade.
 *
 * Audit-ratified mapping:
 *   integrity        → Wadanjirka
 *   purpose          → Soomaalinimo
 *   accountability   → Xil
 *   dignity          → Sharaf
 *   empathy          → Naxariis
 *   inclusion        → Tol
 *   assets           → Refugee resilience
 *   innovation       → Pastoral leadership
 *   prosperity       → Aragti dheer
 *   humility         → Geed daad
 *   democracy        → Hooyo
 *   peace            → Maslaxad
 */

const EXPECTED_AFFINITY: ReadonlyArray<{ practice: PracticeTag; framing: string }> = [
  { practice: 'integrity', framing: 'Wadanjirka' },
  { practice: 'purpose', framing: 'Soomaalinimo' },
  { practice: 'accountability', framing: 'Xil' },
  { practice: 'dignity', framing: 'Sharaf' },
  { practice: 'empathy', framing: 'Naxariis' },
  { practice: 'inclusion', framing: 'Tol' },
  { practice: 'assets', framing: 'Refugee resilience' },
  { practice: 'innovation', framing: 'Pastoral leadership' },
  { practice: 'prosperity', framing: 'Aragti dheer' },
  { practice: 'humility', framing: 'Geed daad' },
  { practice: 'democracy', framing: 'Hooyo' },
  { practice: 'peace', framing: 'Maslaxad' },
];

describe('Phase 12 R7+R8+R9 — cultural framing affinity cascade', () => {
  for (const { practice, framing } of EXPECTED_AFFINITY) {
    it(`${practice} → ${framing}`, () => {
      expect(findFramingForPractice(culturalFramingV1, practice)).toBe(framing);
    });
  }

  it('Xil is now in the v1 library (was previously v2-DRAFT only)', () => {
    expect(culturalFramingV1.framings.find((f) => f.concept === 'Xil')).toBeDefined();
  });

  it('every practice maps to a real framing in the library', () => {
    for (const { practice, framing } of EXPECTED_AFFINITY) {
      const lookup = findFramingForPractice(culturalFramingV1, practice);
      expect(lookup).toBe(framing);
      expect(culturalFramingV1.framings.find((f) => f.concept === lookup)).toBeDefined();
    }
  });
});
