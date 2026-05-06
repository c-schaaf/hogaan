import { describe, expect, it } from 'vitest';
import {
  findFramingForPractice,
  selectCulturalFraming,
} from '../../src/prompt-assembly/framings.js';
import { culturalFramingV1 } from '../../src/libraries/seed/cultural-framing.js';
import { PRACTICE_TAGS, type PracticeTag } from '../../src/shared/types/index.js';
import type { CulturalFramingPayload } from '../../src/libraries/index.js';

/**
 * Phase 12 R6 — data-driven cultural framing affinity.
 *
 * findFramingForPractice scans the library for framings whose
 * practicesMapped includes the requested practice. Tie-break: first by
 * concept name lexically.
 *
 * Backwards compat: if NO framing carries practicesMapped (pre-R7-9
 * library), the legacy PRACTICE_TO_FRAMING table provides fallback.
 */

describe('Phase 12 R6 — findFramingForPractice (data-driven)', () => {
  it('matches a framing whose practicesMapped includes the practice', () => {
    const lib: CulturalFramingPayload = {
      framings: [
        {
          concept: 'Xil',
          gloss: 'duty',
          shortDescription: 'role debt',
          applicableWhen: [],
          examplePhrasings: [],
          practicesMapped: ['accountability'],
        },
      ],
    };
    expect(findFramingForPractice(lib, 'accountability')).toBe('Xil');
  });

  it('tie-break: when multiple framings match, picks first by concept name lexically', () => {
    const lib: CulturalFramingPayload = {
      framings: [
        {
          concept: 'Naxariis',
          gloss: 'compassion',
          shortDescription: '',
          applicableWhen: [],
          examplePhrasings: [],
          practicesMapped: ['empathy', 'humility'],
        },
        {
          concept: 'Geed daad',
          gloss: 'council tree',
          shortDescription: '',
          applicableWhen: [],
          examplePhrasings: [],
          practicesMapped: ['humility'],
        },
      ],
    };
    // Both 'Geed daad' and 'Naxariis' match humility; 'Geed daad' < 'Naxariis' lex.
    expect(findFramingForPractice(lib, 'humility')).toBe('Geed daad');
  });

  it('legacy fallback: no framings carry practicesMapped → use static table', () => {
    const lib: CulturalFramingPayload = {
      framings: [
        {
          concept: 'Whatever',
          gloss: '',
          shortDescription: '',
          applicableWhen: [],
          examplePhrasings: [],
          // No practicesMapped — legacy mode.
        },
      ],
    };
    // Legacy table maps integrity → Sharaf, regardless of what the lib has.
    expect(findFramingForPractice(lib, 'integrity')).toBe('Sharaf');
  });

  it('returns null when practice is unknown and lib is empty', () => {
    const lib: CulturalFramingPayload = { framings: [] };
    // Legacy fallback covers all 12 practices, so this should match Sharaf.
    expect(findFramingForPractice(lib, 'integrity')).toBe('Sharaf');
  });
});

describe('Phase 12 R6 — selectCulturalFraming uses data-driven affinity', () => {
  it('with a v2-style library (practicesMapped present), picks the data-driven framing', () => {
    const lib: CulturalFramingPayload = {
      framings: [
        {
          concept: 'Xil',
          gloss: 'duty',
          shortDescription: 'role debt',
          applicableWhen: ['leader feels weight'],
          examplePhrasings: ['phrase one'],
          practicesMapped: ['accountability'],
        },
      ],
    };
    const result = selectCulturalFraming(lib, 'FullCoachingResponse', 'accountability');
    expect(result).not.toBeNull();
    expect(result?.concept).toBe('Xil');
  });

  it('returns null on excluded modes regardless of practice', () => {
    expect(selectCulturalFraming(culturalFramingV1, 'ClarifyingQuestion', 'integrity')).toBeNull();
    expect(selectCulturalFraming(culturalFramingV1, 'MetaResponse', 'integrity')).toBeNull();
    expect(
      selectCulturalFraming(culturalFramingV1, 'ProfileUpdateAcknowledgment', 'integrity'),
    ).toBeNull();
  });
});

describe('Phase 12 R6 — no practice is a framing-orphan', () => {
  it('every PracticeTag resolves to SOME framing (legacy fallback or data-driven)', () => {
    for (const p of PRACTICE_TAGS as readonly PracticeTag[]) {
      const concept = findFramingForPractice(culturalFramingV1, p);
      expect(concept, `practice ${p} has no framing`).not.toBeNull();
    }
  });
});
