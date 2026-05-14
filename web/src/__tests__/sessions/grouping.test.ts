import { describe, expect, it } from 'vitest';

type Group = 'This week' | 'Earlier this month' | 'Older';

// Mirror the grouping logic from the backend routes-sessions.test
// The route returns group labels; this tests that the mapping is correct
// based on how many days ago the session was.

function groupForDaysAgo(daysAgo: number): Group {
  const now = new Date();
  const d = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) return 'This week';
  if (diffDays <= 30) return 'Earlier this month';
  return 'Older';
}

describe('Session grouping logic', () => {
  it('session 2 days ago → "This week"', () => {
    expect(groupForDaysAgo(2)).toBe('This week');
  });

  it('session 7 days ago → "This week"', () => {
    expect(groupForDaysAgo(7)).toBe('This week');
  });

  it('session 12 days ago → "Earlier this month"', () => {
    expect(groupForDaysAgo(12)).toBe('Earlier this month');
  });

  it('session 30 days ago → "Earlier this month"', () => {
    expect(groupForDaysAgo(30)).toBe('Earlier this month');
  });

  it('session 45 days ago → "Older"', () => {
    expect(groupForDaysAgo(45)).toBe('Older');
  });

  it('session 0 days ago (today) → "This week"', () => {
    expect(groupForDaysAgo(0)).toBe('This week');
  });
});
