import { describe, expect, it } from 'vitest';
import { extractCodeCandidate } from '../../src/onboarding/index.js';

describe('extractCodeCandidate', () => {
  it('extracts a canonical code like kobciye-3742', () => {
    expect(extractCodeCandidate('hi here is my code: kobciye-3742')).toBe('kobciye-3742');
    expect(extractCodeCandidate('kobciye-3742')).toBe('kobciye-3742');
  });

  it('lower-cases mixed-case codes', () => {
    expect(extractCodeCandidate('KOBCIYE-3742')).toBe('kobciye-3742');
  });

  it('rejects too-short numeric suffix (avoids matching "x-12" hyphenated phrases)', () => {
    expect(extractCodeCandidate('section-12 of the report')).toBeNull();
  });

  it('returns null when no code-shaped token present', () => {
    expect(extractCodeCandidate('hello there, no code today')).toBeNull();
    expect(extractCodeCandidate('')).toBeNull();
  });

  it('only takes the first matching token', () => {
    expect(extractCodeCandidate('kobciye-3742 and also alpha-9999')).toBe('kobciye-3742');
  });
});
