import { describe, expect, it } from 'vitest';
import {
  INTENTS,
  isLevelTag,
  isPracticeTag,
  LEVEL_TAGS,
  noDegradation,
  PRACTICE_TAGS,
  RESPONSE_MODES,
} from '../../src/shared/types/index.js';

describe('shared types', () => {
  it('exposes 12 practices', () => {
    expect(PRACTICE_TAGS).toHaveLength(12);
    expect(isPracticeTag('integrity')).toBe(true);
    expect(isPracticeTag('not-a-practice')).toBe(false);
  });

  it('exposes 4 levels', () => {
    expect(LEVEL_TAGS).toHaveLength(4);
    expect(isLevelTag('self')).toBe(true);
    expect(isLevelTag('cosmos')).toBe(false);
  });

  it('exposes 5 response modes (FullCoachingResponse + Profile + Clarify + Meta + Scenario)', () => {
    expect(RESPONSE_MODES).toHaveLength(5);
    expect(RESPONSE_MODES).toContain('FullCoachingResponse');
    expect(RESPONSE_MODES).toContain('ScenarioRolePlay');
  });

  it('exposes 8 intents (Process #2 §3 classifier targets)', () => {
    expect(INTENTS).toHaveLength(8);
  });

  it('noDegradation() returns the all-false default flags', () => {
    const flags = noDegradation();
    expect(flags.memoryTruncated).toBe(false);
    expect(flags.sessionTruncated).toBe(false);
    expect(flags.culturalFramingDropped).toBe(false);
    expect(flags.fallbackModelUsed).toBe(false);
    expect(flags.contextFetchPartial).toBe(false);
  });
});
