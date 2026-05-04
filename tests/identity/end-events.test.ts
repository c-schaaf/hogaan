import { describe, expect, it } from 'vitest';
import { IDENTITY_END_EVENTS, isRetryable, isSuccess } from '../../src/identity/end-events.js';

describe('identity end events', () => {
  it('exposes all 11 events', () => {
    expect(IDENTITY_END_EVENTS).toHaveLength(11);
  });

  it('classifies E1/E2/E3 as success', () => {
    expect(isSuccess('E1_ExistingUserAuthenticated')).toBe(true);
    expect(isSuccess('E2_NewUserProvisioned')).toBe(true);
    expect(isSuccess('E3_ResumeOnboardingDetected')).toBe(true);
  });

  it('classifies E4-E11 as not success', () => {
    expect(isSuccess('E4_DuplicateSignupDetected')).toBe(false);
    expect(isSuccess('E5_SuppressedUser')).toBe(false);
    expect(isSuccess('E11_AuditLogFailure')).toBe(false);
  });

  it('classifies E8/E10/E11 as retryable, others not', () => {
    expect(isRetryable('E8_ConcurrentRequestRejected')).toBe(true);
    expect(isRetryable('E10_IdentityServiceUnavailable')).toBe(true);
    expect(isRetryable('E11_AuditLogFailure')).toBe(true);
    expect(isRetryable('E1_ExistingUserAuthenticated')).toBe(false);
    expect(isRetryable('E5_SuppressedUser')).toBe(false);
    expect(isRetryable('E7_MalformedPhoneNumber')).toBe(false);
  });
});
