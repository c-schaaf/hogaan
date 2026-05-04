import { describe, expect, it } from 'vitest';
import { isOptOutMessage } from '../../src/onboarding/index.js';

describe('isOptOutMessage', () => {
  it('detects bare STOP / UNSUBSCRIBE / LEAVE / OPT OUT (case-insensitive)', () => {
    for (const kw of ['STOP', 'unsubscribe', 'Leave', 'OPT OUT', 'optout', 'cancel', 'END']) {
      expect(isOptOutMessage(kw)).toBe(true);
    }
  });

  it('detects opt-out keywords with surrounding punctuation', () => {
    expect(isOptOutMessage('STOP!')).toBe(true);
    expect(isOptOutMessage('please unsubscribe.')).toBe(true);
    expect(isOptOutMessage('  stop ')).toBe(true);
  });

  it('does NOT match opt-out keyword as substring of another word', () => {
    // "stopwatch" contains "stop" but should not trip opt-out.
    expect(isOptOutMessage('I bought a stopwatch')).toBe(false);
    expect(isOptOutMessage('lemma legend')).toBe(false);
  });

  it('does NOT trip on unrelated text', () => {
    expect(isOptOutMessage('hi how are you?')).toBe(false);
    expect(isOptOutMessage('I want to start coaching')).toBe(false);
  });

  it('handles empty / whitespace input', () => {
    expect(isOptOutMessage('')).toBe(false);
    expect(isOptOutMessage('   ')).toBe(false);
  });
});
