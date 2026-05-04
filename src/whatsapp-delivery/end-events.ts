/**
 * Process #11 has 15 terminal end events. Every outbound dispatch lands at
 * exactly one — including the asynchronous reconciliation events fired when
 * Twilio status webhooks arrive.
 *
 * Naming sticks to the BPMN. The orchestrator emits E1..E13 + E15 inline; the
 * webhook reconciliation subprocess emits E4 / E14.
 */
export const WHATSAPP_END_EVENTS = [
  'E1_MessageDispatched',
  'E2_MessageDispatchedAfterRetry',
  'E3_MessageDispatchedQueued',
  'E4_MessageDeliveredReconciled',
  'E5_DuplicateRequest',
  'E6_MalformedRequest',
  'E7_SuppressedRecipient',
  'E8_WindowClosedFreeFormBlocked',
  'E9_TemplateInvalid',
  'E10_RateLimitExceeded',
  'E11_AccountSuspended',
  'E12_PermanentDeliveryFailure',
  'E13_TransientFailureExhausted',
  'E14_FailedDeliveryReconciled',
  'E15_IdempotencyStoreFailure',
] as const;

export type WhatsappEndEvent = (typeof WHATSAPP_END_EVENTS)[number];

/** Successful API-level dispatch (still pending user-side delivery confirmation). */
export function isDispatchSuccess(event: WhatsappEndEvent): boolean {
  return (
    event === 'E1_MessageDispatched' ||
    event === 'E2_MessageDispatchedAfterRetry' ||
    event === 'E3_MessageDispatchedQueued'
  );
}

/** Hard-fail terminal events that should never auto-retry. */
export function isHardFailure(event: WhatsappEndEvent): boolean {
  return (
    event === 'E11_AccountSuspended' ||
    event === 'E12_PermanentDeliveryFailure' ||
    event === 'E14_FailedDeliveryReconciled'
  );
}
