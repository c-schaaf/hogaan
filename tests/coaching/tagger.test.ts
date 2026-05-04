import { describe, expect, it } from 'vitest';
import { tagPracticeAndLevel } from '../../src/coaching/index.js';

describe('tagPracticeAndLevel — message-driven', () => {
  it('tags integrity + self for "I am compromising my standards on this deal"', () => {
    const r = tagPracticeAndLevel('I am compromising my standards on this deal', []);
    expect(r.practiceTag).toBe('integrity');
    expect(r.tagSource).toBe('message');
  });

  it('tags peace + team for "There is a feud between two of my reports"', () => {
    const r = tagPracticeAndLevel('there is a feud between two of my reports', []);
    expect(r.practiceTag).toBe('peace');
    expect(r.levelTag).toBe('team');
  });

  it('tags humility + organization for an "I do not know" + org context', () => {
    const r = tagPracticeAndLevel(
      "I'm leading the leadership team and I don't know if I'm wrong",
      [],
    );
    expect(r.practiceTag).toBe('humility');
    expect(r.levelTag).toBe('organization');
  });

  it('tags democracy + community on "fair process" + civic context', () => {
    const r = tagPracticeAndLevel('I want a fair process around this civic decision', []);
    expect(r.practiceTag).toBe('democracy');
    expect(r.levelTag).toBe('community');
  });
});

describe('tagPracticeAndLevel — fallbacks', () => {
  it('uses profile mappedPractices when no message keyword hits', () => {
    const r = tagPracticeAndLevel('what should I do this week', ['accountability', 'purpose']);
    expect(r.practiceTag).toBe('accountability');
    expect(r.tagSource).toBe('profile');
  });

  it('falls back to integrity when neither profile nor message has a hit', () => {
    const r = tagPracticeAndLevel('what should I do this week', []);
    expect(r.practiceTag).toBe('integrity');
    expect(r.tagSource).toBe('fallback');
  });

  it('defaults level to self when no level keywords', () => {
    const r = tagPracticeAndLevel('what should I do this week', []);
    expect(r.levelTag).toBe('self');
  });
});
