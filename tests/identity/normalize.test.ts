import { describe, expect, it } from 'vitest';
import { normalizePhone, PhoneNormalizationError } from '../../src/identity/normalize.js';

describe('normalizePhone', () => {
  it('accepts a fully E.164 Somali number', () => {
    const r = normalizePhone('+252612345678');
    expect(r.e164).toBe('+252612345678');
    expect(r.countrySource).toBe('explicit');
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('strips whitespace, dashes, and parens', () => {
    const r = normalizePhone('+252 (61) 234-5678');
    expect(r.e164).toBe('+252612345678');
  });

  it('converts 00-prefix to +', () => {
    const r = normalizePhone('00252612345678');
    expect(r.e164).toBe('+252612345678');
    expect(r.countrySource).toBe('explicit');
  });

  it('infers Somalia country code when no prefix', () => {
    const r = normalizePhone('612345678');
    expect(r.e164).toBe('+252612345678');
    expect(r.countrySource).toBe('inferred-so');
  });

  it('accepts a non-Somali E.164 number with explicit country', () => {
    const r = normalizePhone('+254712345678');
    expect(r.e164).toBe('+254712345678');
    expect(r.countrySource).toBe('explicit');
  });

  it('rejects an empty string', () => {
    expect(() => normalizePhone('')).toThrow(PhoneNormalizationError);
  });

  it('rejects non-digit garbage', () => {
    expect(() => normalizePhone('not-a-phone')).toThrow(PhoneNormalizationError);
  });

  it('rejects too-short numbers', () => {
    expect(() => normalizePhone('+1234')).toThrow(PhoneNormalizationError);
  });

  it('produces the same hash for the same E.164 across input formats', () => {
    const a = normalizePhone('+252612345678');
    const b = normalizePhone('00252612345678');
    const c = normalizePhone('612345678');
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toBe(c.hash);
  });
});
