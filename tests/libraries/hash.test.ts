import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalStringify } from '../../src/libraries/hash.js';

describe('canonicalHash', () => {
  it('produces the same hash regardless of object key order', () => {
    const a = { a: 1, b: { c: 2, d: 3 }, e: [1, 2, 3] };
    const b = { e: [1, 2, 3], b: { d: 3, c: 2 }, a: 1 };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it('changes when content changes', () => {
    const a = { x: 1 };
    const b = { x: 2 };
    expect(canonicalHash(a)).not.toBe(canonicalHash(b));
  });

  it('preserves array order', () => {
    const a = [1, 2, 3];
    const b = [3, 2, 1];
    expect(canonicalHash(a)).not.toBe(canonicalHash(b));
  });

  it('treats null/undefined deterministically', () => {
    const a = { x: null, y: 1 };
    const b = { y: 1, x: null };
    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it('produces 64-char hex', () => {
    expect(canonicalHash({ x: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('canonicalStringify', () => {
  it('sorts nested keys alphabetically', () => {
    const out = canonicalStringify({ b: 1, a: { z: 1, y: 2 } });
    expect(out).toBe('{"a":{"y":2,"z":1},"b":1}');
  });
});
