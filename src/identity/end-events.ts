/**
 * Process #12 has eleven terminal end events. Every successful or failed
 * resolution lands at exactly one. The IdentityResult discriminator below is
 * how downstream callers (Onboarding, Coaching, web API) dispatch.
 */
export const IDENTITY_END_EVENTS = [
  'E1_ExistingUserAuthenticated',
  'E2_NewUserProvisioned',
  'E3_ResumeOnboardingDetected',
  'E4_DuplicateSignupDetected',
  'E5_SuppressedUser',
  'E6_BlockedUser',
  'E7_MalformedPhoneNumber',
  'E8_ConcurrentRequestRejected',
  'E9_WebSessionInvalid',
  'E10_IdentityServiceUnavailable',
  'E11_AuditLogFailure',
] as const;

export type IdentityEndEvent = (typeof IDENTITY_END_EVENTS)[number];

/** Whether this end event indicates the caller should retry. */
export function isRetryable(event: IdentityEndEvent): boolean {
  return (
    event === 'E8_ConcurrentRequestRejected' ||
    event === 'E10_IdentityServiceUnavailable' ||
    event === 'E11_AuditLogFailure'
  );
}

/** Whether this end event represents a successful identification. */
export function isSuccess(event: IdentityEndEvent): boolean {
  return (
    event === 'E1_ExistingUserAuthenticated' ||
    event === 'E2_NewUserProvisioned' ||
    event === 'E3_ResumeOnboardingDetected'
  );
}
