/**
 * Process #1 has 8 terminal end events.
 *
 * Success: E1 (clean first try), E2 (resumed mid-flow).
 * Soft-park: E4 (dormant — user can resume).
 * Decline: E3 (consent declined), E5 (explicit opt-out).
 * Defaults applied: E7 (ClarificationLoopExceeded — onboarding completes
 * but profile.needs_profile_review=true so ops can follow up).
 * Failure: E6 (system error), E8 (already onboarded; routed to coaching).
 */
export const ONBOARDING_END_EVENTS = [
  'E1_CompletedFirstTry',
  'E2_CompletedAfterResume',
  'E3_ConsentDeclined',
  'E4_OnboardingDormantParked',
  'E5_OnboardingAbandoned',
  'E6_ServiceUnavailable',
  'E7_ClarificationLoopExceeded',
  'E8_DuplicateNumber',
] as const;

export type OnboardingEndEvent = (typeof ONBOARDING_END_EVENTS)[number];

export function isOnboardingComplete(event: OnboardingEndEvent): boolean {
  return (
    event === 'E1_CompletedFirstTry' ||
    event === 'E2_CompletedAfterResume' ||
    event === 'E7_ClarificationLoopExceeded'
  );
}
