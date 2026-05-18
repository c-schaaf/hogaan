import { describe, expect, it } from 'vitest';
import { computeDeterminismHash } from '../../src/prompt-assembly/index.js';
import type { LibraryVersionSet } from '../../src/shared/types/index.js';

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
      systemTemplateId: 'coaching_v0_unified',
      practiceTag: 'integrity',
      levelTag: 'self',
      libraryVersions: libs,
    });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is identical for identical structural inputs (resolvedAt does NOT contribute)', () => {
    const a = computeDeterminismHash({
      responseMode: 'FullCoachingResponse',
      systemTemplateId: 'coaching_v0_unified',
      practiceTag: 'integrity',
      levelTag: 'self',
      libraryVersions: libs,
    });
    const b = computeDeterminismHash({
      responseMode: 'FullCoachingResponse',
      systemTemplateId: 'coaching_v0_unified',
      practiceTag: 'integrity',
      levelTag: 'self',
      libraryVersions: { ...libs, resolvedAt: new Date('2099-12-31T23:59:59Z') },
    });
    expect(a).toBe(b);
  });

  it('differs when responseMode changes', () => {
    const a = computeDeterminismHash({
      responseMode: 'FullCoachingResponse',
      systemTemplateId: 'coaching_v0_unified',
      practiceTag: 'integrity',
      levelTag: 'self',
      libraryVersions: libs,
    });
    const b = computeDeterminismHash({
      responseMode: 'ClarifyingQuestion',
      systemTemplateId: 'coaching_v0_unified',
      practiceTag: 'integrity',
      levelTag: 'self',
      libraryVersions: libs,
    });
    expect(a).not.toBe(b);
  });

  it('differs when promptTemplates library version changes (drift detection)', () => {
    const a = computeDeterminismHash({
      responseMode: 'FullCoachingResponse',
      systemTemplateId: 'coaching_v0_unified',
      practiceTag: 'integrity',
      levelTag: 'self',
      libraryVersions: libs,
    });
    const b = computeDeterminismHash({
      responseMode: 'FullCoachingResponse',
      systemTemplateId: 'coaching_v0_unified',
      practiceTag: 'integrity',
      levelTag: 'self',
      libraryVersions: { ...libs, promptTemplates: { version: 'v3', hash: 'zzzz' } },
    });
    expect(a).not.toBe(b);
  });
});
