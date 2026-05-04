import { describe, expect, it } from 'vitest';
import {
  isQcApproved,
  isQcFallbackResponse,
  QC_END_EVENTS,
} from '../../src/quality-check/index.js';

describe('QC end events', () => {
  it('exposes 7 events', () => {
    expect(QC_END_EVENTS).toHaveLength(7);
  });

  it('classifies E1 + E2 as approved', () => {
    expect(isQcApproved('E1_ApprovedFirstAttempt')).toBe(true);
    expect(isQcApproved('E2_ApprovedRegenerated')).toBe(true);
  });

  it('classifies E3..E7 as not approved', () => {
    expect(isQcApproved('E3_MaxRetriesExceeded')).toBe(false);
    expect(isQcApproved('E4_CrisisEscalation')).toBe(false);
    expect(isQcApproved('E5_SafetyHardFailure')).toBe(false);
    expect(isQcApproved('E6_ServiceUnavailable')).toBe(false);
    expect(isQcApproved('E7_MalformedInput')).toBe(false);
  });

  it('classifies E3 + E6 as fallback-response variants (caller delivers a holding message)', () => {
    expect(isQcFallbackResponse('E3_MaxRetriesExceeded')).toBe(true);
    expect(isQcFallbackResponse('E6_ServiceUnavailable')).toBe(true);
  });

  it('does NOT classify E4/E5/E7 as fallback-response (they are crisis-handoff or hard-fail)', () => {
    expect(isQcFallbackResponse('E4_CrisisEscalation')).toBe(false);
    expect(isQcFallbackResponse('E5_SafetyHardFailure')).toBe(false);
    expect(isQcFallbackResponse('E7_MalformedInput')).toBe(false);
  });
});
