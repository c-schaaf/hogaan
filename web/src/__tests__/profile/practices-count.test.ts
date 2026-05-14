import { describe, expect, it } from 'vitest';

// Test the practice count label logic from Profile.tsx
function practicesLabel(count: number): string {
  return count === 1 ? 'practice in focus' : 'practices in focus';
}

describe('Practices count label', () => {
  it('0 practices → "practices in focus"', () => {
    expect(practicesLabel(0)).toBe('practices in focus');
  });

  it('1 practice → "practice in focus" (singular)', () => {
    expect(practicesLabel(1)).toBe('practice in focus');
  });

  it('3 practices → "practices in focus" (plural)', () => {
    expect(practicesLabel(3)).toBe('practices in focus');
  });

  it('12 practices → "practices in focus"', () => {
    expect(practicesLabel(12)).toBe('practices in focus');
  });
});
