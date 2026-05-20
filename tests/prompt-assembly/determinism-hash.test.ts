import { describe, expect, it } from 'vitest';
import {
  computeDeterminismHash,
  DETERMINISM_HASH_VERSION,
} from '../../src/prompt-assembly/index.js';
import type { LibraryVersionSet } from '../../src/shared/types/index.js';

// SCRUM (PR 5) — bumped to v3 with the trimmed structural input set. The
// tagger fields (practiceTag, levelTag, secondary*, taggerConfidence) are
// gone from the hash input — they were always null on every live row
// because the tagger has been stubbed since the unified prompt landed.

const libs: LibraryVersionSet = {
  promptTemplates: { version: 'v2_unified', hash: 'aaaa' },
  voiceRules: { version: 'v1', hash: 'bbbb' },
  culturalFraming: { version: 'v1', hash: 'cccc' },
  resolvedAt: new Date('2026-05-04T12:00:00Z'),
};

describe('computeDeterminismHash', () => {
  it('produces 64-hex SHA-256 digest', () => {
    const h = computeDeterminismHash({
      responseMode: 'FullCoachingResponse',
      systemTemplateId: 'coaching_v3_leadership',
      libraryVersions: libs,
    });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is identical for identical structural inputs (resolvedAt does NOT contribute)', () => {
    const a = computeDeterminismHash({
      responseMode: 'FullCoachingResponse',
      systemTemplateId: 'coaching_v3_leadership',
      libraryVersions: libs,
    });
    const b = computeDeterminismHash({
      responseMode: 'FullCoachingResponse',
      systemTemplateId: 'coaching_v3_leadership',
      libraryVersions: { ...libs, resolvedAt: new Date('2099-12-31T23:59:59Z') },
    });
    expect(a).toBe(b);
  });

  it('differs when responseMode changes', () => {
    const a = computeDeterminismHash({
      responseMode: 'FullCoachingResponse',
      systemTemplateId: 'coaching_v3_leadership',
      libraryVersions: libs,
    });
    const b = computeDeterminismHash({
      responseMode: 'ClarifyingQuestion',
      systemTemplateId: 'coaching_v3_leadership',
      libraryVersions: libs,
    });
    expect(a).not.toBe(b);
  });

  it('differs when promptTemplates library version changes (drift detection)', () => {
    const a = computeDeterminismHash({
      responseMode: 'FullCoachingResponse',
      systemTemplateId: 'coaching_v3_leadership',
      libraryVersions: libs,
    });
    const b = computeDeterminismHash({
      responseMode: 'FullCoachingResponse',
      systemTemplateId: 'coaching_v3_leadership',
      libraryVersions: { ...libs, promptTemplates: { version: 'v3', hash: 'zzzz' } },
    });
    expect(a).not.toBe(b);
  });

  it('is pinned to v3 (cohort boundary marker for the audit harness)', () => {
    expect(DETERMINISM_HASH_VERSION).toBe('v3');
  });
});
