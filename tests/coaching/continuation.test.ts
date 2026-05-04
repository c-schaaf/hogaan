import { describe, expect, it } from 'vitest';
import { decideContinuation } from '../../src/coaching/index.js';

describe('decideContinuation', () => {
  it('closes on bare "bye"', () => {
    expect(decideContinuation('bye')).toBe('close');
    expect(decideContinuation('Bye!')).toBe('close');
    expect(decideContinuation('goodbye')).toBe('close');
  });

  it('closes on "thanks bye" / "thanks, bye"', () => {
    expect(decideContinuation('thanks bye')).toBe('close');
    expect(decideContinuation('thanks, bye')).toBe('close');
  });

  it('does NOT close on bare "thanks" (could be mid-conversation ack)', () => {
    expect(decideContinuation('thanks')).toBe('continue');
    expect(decideContinuation('thank you')).toBe('continue');
  });

  it('does NOT close on questions', () => {
    expect(decideContinuation('how do I lead my team?')).toBe('continue');
    expect(decideContinuation('what is the next step?')).toBe('continue');
  });

  it('handles "see you" / "see ya"', () => {
    expect(decideContinuation('see you')).toBe('close');
    expect(decideContinuation('see ya')).toBe('close');
  });
});
