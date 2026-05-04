import { describe, expect, it } from 'vitest';
import {
  goalsToPractices,
  parseConsent,
  parseGoals,
  parseLocation,
  parseRole,
} from '../../src/onboarding/parsers.js';

describe('parseConsent', () => {
  it('accepts plain yes/yeah/sure/ok variants', () => {
    for (const v of ['yes', 'YES', 'yeah', 'sure', 'OK', 'okay', 'agreed']) {
      expect(parseConsent(v)).toBe('yes');
    }
  });
  it('accepts Somali yes (sow / haa)', () => {
    expect(parseConsent('sow')).toBe('yes');
    expect(parseConsent('haa')).toBe('yes');
  });
  it('rejects no/nope/stop/skip', () => {
    for (const v of ['no', 'NOPE', "I don't", 'stop', 'skip']) {
      expect(parseConsent(v)).toBe('no');
    }
  });
  it('rejects ambiguous text', () => {
    expect(parseConsent('what does this mean')).toBe('ambiguous');
    expect(parseConsent('hmm let me think')).toBe('ambiguous');
  });
});

describe('parseGoals', () => {
  it('accepts a single number', () => {
    const r = parseGoals('1');
    expect(r).not.toBe('invalid');
    if (r !== 'invalid') {
      expect(r.goals).toEqual(['Leadership confidence']);
    }
  });
  it('accepts multiple numbers comma-separated', () => {
    const r = parseGoals('1, 3');
    if (r === 'invalid') {
      throw new Error('expected parse');
    }
    expect(r.goals).toContain('Leadership confidence');
    expect(r.goals).toContain('Conflict resolution');
  });
  it('accepts keyword phrasing ("conflict resolution", "career growth")', () => {
    const r1 = parseGoals('conflict resolution');
    expect(r1 !== 'invalid' && r1.goals.includes('Conflict resolution')).toBe(true);
    const r2 = parseGoals("career growth, that's what I'm focused on");
    expect(r2 !== 'invalid' && r2.goals.includes('Career growth')).toBe(true);
  });
  it('rejects nonsense', () => {
    expect(parseGoals('asdfghjkl')).toBe('invalid');
  });
});

describe('goalsToPractices', () => {
  it('maps Leadership confidence → integrity + purpose', () => {
    const p = goalsToPractices(['Leadership confidence']);
    expect(p).toContain('integrity');
    expect(p).toContain('purpose');
  });
  it('deduplicates across multiple goals', () => {
    const p = goalsToPractices(['Communication', 'Conflict resolution']);
    // Both share 'empathy' — should appear only once.
    expect(p.filter((x) => x === 'empathy')).toHaveLength(1);
  });
});

describe('parseRole', () => {
  it('accepts numeric 1-3', () => {
    expect(parseRole('1')).toBe('Student');
    expect(parseRole('2')).toBe('Professional');
    expect(parseRole('3')).toBe('Leader');
  });
  it('prefers Leader on ambiguous "lead engineer"', () => {
    expect(parseRole('I am a lead engineer')).toBe('Leader');
  });
  it('accepts plain role words', () => {
    expect(parseRole('Student')).toBe('Student');
    expect(parseRole('professional')).toBe('Professional');
    expect(parseRole('manager')).toBe('Leader');
  });
  it('rejects nonsense', () => {
    expect(parseRole('purple')).toBe('invalid');
  });
});

describe('parseLocation', () => {
  it('returns skip for "skip" and variants', () => {
    expect(parseLocation('skip')).toBe('skip');
    expect(parseLocation('rather not')).toBe('skip');
    expect(parseLocation('private')).toBe('skip');
  });
  it('detects Mogadishu as non-diaspora', () => {
    const r = parseLocation('Mogadishu, Somalia');
    if (r === 'skip') {
      throw new Error('expected location');
    }
    expect(r.isDiaspora).toBe(false);
    expect(r.timezone).toBe('Africa/Mogadishu');
  });
  it('detects Hargeisa as non-diaspora', () => {
    const r = parseLocation('Hargeisa');
    expect(r !== 'skip' && r.isDiaspora === false).toBe(true);
  });
  it('detects Nairobi as non-diaspora (Horn of Africa)', () => {
    const r = parseLocation('Nairobi, Kenya');
    expect(r !== 'skip' && r.isDiaspora === false).toBe(true);
  });
  it('detects Minneapolis as diaspora', () => {
    const r = parseLocation('Minneapolis, MN, USA');
    expect(r !== 'skip' && r.isDiaspora === true).toBe(true);
  });
});
