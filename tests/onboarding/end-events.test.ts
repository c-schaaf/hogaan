import { describe, expect, it } from 'vitest';
import { ONBOARDING_END_EVENTS, isOnboardingComplete } from '../../src/onboarding/index.js';

describe('onboarding end events', () => {
  it('exposes all 8 events', () => {
    expect(ONBOARDING_END_EVENTS).toHaveLength(8);
  });

  it('classifies E1/E2/E7 as completed (E7 completes with defaults applied)', () => {
    expect(isOnboardingComplete('E1_CompletedFirstTry')).toBe(true);
    expect(isOnboardingComplete('E2_CompletedAfterResume')).toBe(true);
    expect(isOnboardingComplete('E7_ClarificationLoopExceeded')).toBe(true);
  });

  it('classifies E3/E4/E5/E6/E8 as not-completed', () => {
    expect(isOnboardingComplete('E3_ConsentDeclined')).toBe(false);
    expect(isOnboardingComplete('E4_OnboardingDormantParked')).toBe(false);
    expect(isOnboardingComplete('E5_OnboardingAbandoned')).toBe(false);
    expect(isOnboardingComplete('E6_ServiceUnavailable')).toBe(false);
    expect(isOnboardingComplete('E8_DuplicateNumber')).toBe(false);
  });
});
