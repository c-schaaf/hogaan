import { describe, expect, it } from 'vitest';
import {
  COACHING_END_EVENTS,
  isCoachingTurnSuccess,
} from '../../src/coaching/index.js';

describe('coaching end events', () => {
  it('exposes all 11 events', () => {
    expect(COACHING_END_EVENTS).toHaveLength(11);
  });

  it('classifies E1 + E2 as turn success', () => {
    expect(isCoachingTurnSuccess('E1_TurnCompleted')).toBe(true);
    expect(isCoachingTurnSuccess('E2_TurnCompletedSessionClosed')).toBe(true);
  });

  it('classifies non-success endings as not-success', () => {
    expect(isCoachingTurnSuccess('E3_DegradedQuality')).toBe(false);
    expect(isCoachingTurnSuccess('E11_ServiceUnavailable')).toBe(false);
    expect(isCoachingTurnSuccess('E12_SilentDrop')).toBe(false);
  });
});
