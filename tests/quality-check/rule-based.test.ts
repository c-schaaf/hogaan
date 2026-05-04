import { describe, expect, it } from 'vitest';
import { voiceRulesV1 } from '../../src/libraries/index.js';
import {
  check1PracticeTag,
  check2LevelTag,
  check5HeroToGuide,
  check6UsefulToSociety,
  check9Length,
} from '../../src/quality-check/index.js';

describe('check1PracticeTag', () => {
  it('passes a known practice', () => {
    expect(check1PracticeTag('integrity').outcome.status).toBe('pass');
  });
  it('hard-fails an unknown practice', () => {
    const r = check1PracticeTag('fortitude' as never);
    expect(r.outcome.status).toBe('hard_fail');
  });
  it('returns not_required when undefined', () => {
    expect(check1PracticeTag(undefined).outcome.status).toBe('not_required');
  });
});

describe('check2LevelTag', () => {
  it('passes self/team/organization/community', () => {
    for (const lvl of ['self', 'team', 'organization', 'community'] as const) {
      expect(check2LevelTag(lvl).outcome.status).toBe('pass');
    }
  });
  it('hard-fails an unknown level', () => {
    expect(check2LevelTag('cosmos' as never).outcome.status).toBe('hard_fail');
  });
});

describe('check5HeroToGuide', () => {
  it('passes a guide-voice response', () => {
    const r = check5HeroToGuide(
      voiceRulesV1,
      'You already have the language. The next move is yours this Monday.',
    );
    expect(r.outcome.status).toBe('pass');
  });

  it('soft-fails on "I would tell them" hero phrasing', () => {
    const r = check5HeroToGuide(
      voiceRulesV1,
      'I would tell them directly. Here is what I would do.',
    );
    expect(r.outcome.status).toBe('soft_fail');
  });

  it('soft-fails on "you\'ve got this, champion" motivational fluff', () => {
    const r = check5HeroToGuide(voiceRulesV1, "You've got this, champion! Believe in yourself.");
    expect(r.outcome.status).toBe('soft_fail');
  });

  it('is case-insensitive', () => {
    const r = check5HeroToGuide(voiceRulesV1, 'JUST TRUST ME on this one.');
    expect(r.outcome.status).toBe('soft_fail');
  });
});

describe('check6UsefulToSociety', () => {
  it('passes when anchor is present and level is self (required)', () => {
    const r = check6UsefulToSociety(
      voiceRulesV1,
      'This is useful to your team. Lead in service of something larger than the deal.',
      'self',
    );
    expect(r.outcome.status).toBe('pass');
  });

  it('soft-fails on Self level when anchor is missing (fail-closed for Self/Community)', () => {
    const r = check6UsefulToSociety(
      voiceRulesV1,
      'Just optimize your KPIs and ship the deal.',
      'self',
    );
    expect(r.outcome.status).toBe('soft_fail');
  });

  it('soft-fails on Community level when anchor is missing', () => {
    const r = check6UsefulToSociety(
      voiceRulesV1,
      'Just optimize your KPIs and ship the deal.',
      'community',
    );
    expect(r.outcome.status).toBe('soft_fail');
  });

  it('returns not_required on Team/Organization when anchor is missing', () => {
    const r1 = check6UsefulToSociety(
      voiceRulesV1,
      'Just optimize your KPIs and ship the deal.',
      'team',
    );
    expect(r1.outcome.status).toBe('not_required');
    const r2 = check6UsefulToSociety(
      voiceRulesV1,
      'Just optimize your KPIs and ship the deal.',
      'organization',
    );
    expect(r2.outcome.status).toBe('not_required');
  });

  it('returns not_required when level is undefined (e.g. ClarifyingQuestion)', () => {
    const r = check6UsefulToSociety(voiceRulesV1, 'What would Monday look like?', undefined);
    expect(r.outcome.status).toBe('not_required');
  });
});

describe('check9Length', () => {
  it('passes a 150-word FullCoachingResponse', () => {
    const text = Array.from({ length: 150 }, (_, i) => `word${i}`).join(' ');
    expect(check9Length(text, 'FullCoachingResponse').outcome.status).toBe('pass');
  });

  it('soft-fails a too-short FullCoachingResponse', () => {
    const text = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    expect(check9Length(text, 'FullCoachingResponse').outcome.status).toBe('soft_fail');
  });

  it('soft-fails a too-long ClarifyingQuestion', () => {
    const text = Array.from({ length: 150 }, (_, i) => `word${i}`).join(' ');
    expect(check9Length(text, 'ClarifyingQuestion').outcome.status).toBe('soft_fail');
  });

  it('passes a 50-word ClarifyingQuestion', () => {
    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');
    expect(check9Length(text, 'ClarifyingQuestion').outcome.status).toBe('pass');
  });
});
