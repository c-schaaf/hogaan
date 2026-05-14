/**
 * Process #2 has 11 terminal end events. Every coaching turn lands at exactly
 * one. The trace emitter records this verbatim per Phase 1.4 §TurnTrace.
 *
 * Success: E1 (turn done), E2 (turn done + session closed).
 * Branched: E4 scenario, E5 profile, E6 meta, E10 clarifying question.
 * Soft fail: E3 degraded quality, E8 media not supported, E9 rejected,
 *            E11 service unavailable, E12 silent drop on empty input.
 */
export const COACHING_END_EVENTS = [
  'E1_TurnCompleted',
  'E2_TurnCompletedSessionClosed',
  'E3_DegradedQuality',
  'E4_ScenarioHandoff',
  'E5_ProfileAck',
  'E6_MetaResponse',
  'E8_MediaNotSupported',
  'E9_MessageRejected',
  'E10_ClarifyingQuestionSent',
  'E11_ServiceUnavailable',
  'E12_SilentDrop',
] as const;

export type CoachingEndEvent = (typeof COACHING_END_EVENTS)[number];

export function isCoachingTurnSuccess(event: CoachingEndEvent): boolean {
  return event === 'E1_TurnCompleted' || event === 'E2_TurnCompletedSessionClosed';
}
