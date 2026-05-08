import { describe, expect, it } from 'vitest';
import {
  isQcApproved,
  isQcFallbackResponse,
  QC_END_EVENTS,
} from '../../src/quality-check/index.js';

describe('QC end events', () => {
  it('exposes 8 events', () => {
    expect(QC_END_EVENTS).toHaveLength(8);
  });

  it('classifies E1 + E2 as approved', () => {
    expect(isQcApproved('E1_ApprovedFirstAttempt')).toBe(true);
    expect(isQcApproved('E2_ApprovedRegenerated')).toBe(true);
  });

  it('classifies E3..E8 as not approved (incl. E8 ship-degraded — the candidate ships but carries a quality flag)', () => {
    expect(isQcApproved('E3_MaxRetriesExceeded')).toBe(false);
    expect(isQcApproved('E4_CrisisEscalation')).toBe(false);
    expect(isQcApproved('E5_SafetyHardFailure')).toBe(false);
    expect(isQcApproved('E6_ServiceUnavailable')).toBe(false);
    expect(isQcApproved('E7_MalformedInput')).toBe(false);
    expect(isQcApproved('E8_ShipDegradedCandidate')).toBe(false);
  });

  it('classifies E3 + E6 as fallback-response variants (caller delivers a holding message)', () => {
    expect(isQcFallbackResponse('E3_MaxRetriesExceeded')).toBe(true);
    expect(isQcFallbackResponse('E6_ServiceUnavailable')).toBe(true);
  });

  it('does NOT classify E4/E5/E7/E8 as fallback-response — E8 specifically ships the real Haiku candidate, not the fallback template', () => {
    expect(isQcFallbackResponse('E4_CrisisEscalation')).toBe(false);
    expect(isQcFallbackResponse('E5_SafetyHardFailure')).toBe(false);
    expect(isQcFallbackResponse('E7_MalformedInput')).toBe(false);
    expect(isQcFallbackResponse('E8_ShipDegradedCandidate')).toBe(false);
  });
});
