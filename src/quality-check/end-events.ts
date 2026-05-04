/**
 * Process #10 has 7 terminal end events. Two success paths (E1 first attempt,
 * E2 after regeneration) and five failure paths.
 */
export const QC_END_EVENTS = [
  'E1_ApprovedFirstAttempt',
  'E2_ApprovedRegenerated',
  'E3_MaxRetriesExceeded',
  'E4_CrisisEscalation',
  'E5_SafetyHardFailure',
  'E6_ServiceUnavailable',
  'E7_MalformedInput',
] as const;

export type QcEndEvent = (typeof QC_END_EVENTS)[number];

export function isQcApproved(event: QcEndEvent): boolean {
  return event === 'E1_ApprovedFirstAttempt' || event === 'E2_ApprovedRegenerated';
}

export function isQcFallbackResponse(event: QcEndEvent): boolean {
  // E3 + E6 produce a templated holding response. E4 hands off to crisis
  // subprocess (separate dispatch). E5 + E7 are caller-side failures.
  return event === 'E3_MaxRetriesExceeded' || event === 'E6_ServiceUnavailable';
}
