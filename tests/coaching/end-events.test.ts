import { describe, expect, it } from 'vitest';
import {
  COACHING_END_EVENTS,
  isCoachingTurnSuccess,
  isCrisisRouted,
} from '../../src/coaching/index.js';

describe('coaching end events', () => {
  it('exposes all 12 events', () => {
    expect(COACHING_END_EVENTS).toHaveLength(12);
  });

  it('classifies E1 + E2 as turn success', () => {
    expect(isCoachingTurnSuccess('E1_TurnCompleted')).toBe(true);
    expect(isCoachingTurnSuccess('E2_TurnCompletedSessionClosed')).toBe(true);
  });

  it('classifies non-success endings as not-success', () => {
    expect(isCoachingTurnSuccess('E3_DegradedQuality')).toBe(false);
    expect(isCoachingTurnSuccess('E7_Crisis')).toBe(false);
    expect(isCoachingTurnSuccess('E11_ServiceUnavailable')).toBe(false);
    expect(isCoachingTurnSuccess('E12_SilentDrop')).toBe(false);
  });

  it('classifies E7 as crisis-routed', () => {
    expect(isCrisisRouted('E7_Crisis')).toBe(true);
    expect(isCrisisRouted('E1_TurnCompleted')).toBe(false);
  });
});
