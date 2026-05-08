/**
 * Process #10 has 8 terminal end events. Two clean-approval paths (E1 first
 * attempt, E2 after regeneration), five failure paths, and one
 * ship-with-quality-flag path (E8).
 *
 * E8_ShipDegradedCandidate (added 2026-05-08, Option B fix): the R-07
 * predictive budget gate fired AND only soft_fails are present (no Check 8
 * service_unavailable, no hard_fail). The user receives the actual Haiku
 * candidate with `degraded:true` telemetry instead of the fallback template.
 * Safety semantics preserved — fail-closed paths for Check 8 service
 * unavailability and any hard_fail remain on E6 with fallbackDegraded(). See
 * src/quality-check/orchestrator.ts (R-07 gate, three-case dispatch).
 */
export const QC_END_EVENTS = [
  'E1_ApprovedFirstAttempt',
  'E2_ApprovedRegenerated',
  'E3_MaxRetriesExceeded',
  'E4_CrisisEscalation',
  'E5_SafetyHardFailure',
  'E6_ServiceUnavailable',
  'E7_MalformedInput',
  'E8_ShipDegradedCandidate',
] as const;

export type QcEndEvent = (typeof QC_END_EVENTS)[number];

export function isQcApproved(event: QcEndEvent): boolean {
  // E8 is NOT clean-approved — it ships the candidate with a quality flag,
  // surfaced via degraded:true telemetry. Callers that gate on
  // isQcApproved() (e.g., to suppress quality alerts) should NOT treat E8
  // as clean.
  return event === 'E1_ApprovedFirstAttempt' || event === 'E2_ApprovedRegenerated';
}

export function isQcFallbackResponse(event: QcEndEvent): boolean {
  // E3 + E6 produce a templated holding response. E4 hands off to crisis
  // subprocess (separate dispatch). E5 + E7 are caller-side failures. E8
  // ships the REAL Haiku candidate with degraded:true — it is NOT a
  // fallback response, even though it carries a quality flag.
  return event === 'E3_MaxRetriesExceeded' || event === 'E6_ServiceUnavailable';
}
