import { describe, expect, it } from 'vitest';
import {
  isDispatchSuccess,
  isHardFailure,
  WHATSAPP_END_EVENTS,
} from '../../src/whatsapp-delivery/index.js';

describe('whatsapp end events', () => {
  it('exposes all 15 events', () => {
    expect(WHATSAPP_END_EVENTS).toHaveLength(15);
  });

  it('classifies E1/E2/E3 as dispatch success', () => {
    expect(isDispatchSuccess('E1_MessageDispatched')).toBe(true);
    expect(isDispatchSuccess('E2_MessageDispatchedAfterRetry')).toBe(true);
    expect(isDispatchSuccess('E3_MessageDispatchedQueued')).toBe(true);
  });

  it('classifies non-success events correctly', () => {
    expect(isDispatchSuccess('E4_MessageDeliveredReconciled')).toBe(false);
    expect(isDispatchSuccess('E5_DuplicateRequest')).toBe(false);
    expect(isDispatchSuccess('E11_AccountSuspended')).toBe(false);
  });

  it('classifies E11/E12/E14 as hard failures', () => {
    expect(isHardFailure('E11_AccountSuspended')).toBe(true);
    expect(isHardFailure('E12_PermanentDeliveryFailure')).toBe(true);
    expect(isHardFailure('E14_FailedDeliveryReconciled')).toBe(true);
  });

  it('does not classify retryable failures as hard', () => {
    expect(isHardFailure('E10_RateLimitExceeded')).toBe(false);
    expect(isHardFailure('E13_TransientFailureExhausted')).toBe(false);
    expect(isHardFailure('E15_IdempotencyStoreFailure')).toBe(false);
  });
});
