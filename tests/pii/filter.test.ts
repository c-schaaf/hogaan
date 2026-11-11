import { describe, expect, it } from 'vitest';
import { stripPii, surnamesFromFullName } from '../../src/shared/pii/filter.js';

describe('D2 PII filter', () => {
  it('removes email addresses', () => {
    expect(stripPii('write to sarah.j@acme.org today')).toBe('write to [email removed] today');
  });

  it('removes phone numbers in common formats', () => {
    for (const p of ['+1 (612) 555-0199', '612-555-0199', '07700 900123', '+252 61 555 0199']) {
      expect(stripPii(`call ${p} now`)).toBe('call [phone removed] now');
    }
  });

  it('keeps money, years, ranges and ISO dates', () => {
    const t = 'The grant is $1,500,000 for 2025-2026, due 2026-11-12, team of 12.';
    expect(stripPii(t)).toBe(t);
  });

  it('keeps first names but drops surnames', () => {
    expect(stripPii('My director Sarah Johnson pushed back.')).toBe(
      'My director Sarah pushed back.',
    );
    expect(stripPii('I met Mohamed Abdi Hassan.')).toBe('I met Mohamed.');
    expect(stripPii('Yesterday Sarah Johnson said no.')).toBe('Yesterday Sarah said no.');
  });

  it('replaces titled surnames', () => {
    expect(stripPii('Dr. Patel and Ms Okafor agreed')).toBe('Dr. [name] and Ms. [name] agreed');
  });

  it('removes known surnames anywhere, any case', () => {
    expect(stripPii("I'm Amina Yusuf; yusuf is my family name", { knownSurnames: ['Yusuf'] })).toBe(
      "I'm Amina; is my family name",
    );
  });

  it('leaves places, organisations, days and practice names alone', () => {
    const t =
      'We met in New York at the Ford Foundation on Thursday to talk about Integrity and Empathy at Hogaan Leadership.';
    expect(stripPii(t)).toBe(t);
  });

  it('review fix: surnames with inner capitals or apostrophes, and non-English letters', () => {
    expect(stripPii("Sarah O'Brien and Sarah McDonald met the CEO at NASA.")).toBe(
      'Sarah and Sarah met the CEO at NASA.',
    );
    expect(stripPii('Ali Ödegaard spoke', { knownSurnames: ['Ödegaard'] })).toBe('Ali spoke');
    expect(stripPii('ödegaard alone', { knownSurnames: ['Ödegaard'] }).trim()).toBe('alone');
  });

  it('derives surnames from a full name', () => {
    expect(surnamesFromFullName('Amina Farah')).toEqual(['Farah']);
    expect(surnamesFromFullName('Amina')).toEqual([]);
    expect(surnamesFromFullName(null)).toEqual([]);
  });
});
