/**
 * Process #10 §SubProcess_Fallback_MaxRetries (E3) and §SubProcess_Fallback_Degraded
 * (E6) terminal responses.
 *
 * Brand-aligned holding messages — Hamse signed off on the voice rules but the
 * fallback text itself is a v1 baseline pending his explicit review. PRD §10
 * lists "fallback message text needs Hamse approval" as an open item.
 *
 * Both messages stay under the FullCoachingResponse min length (Check 9)
 * INTENTIONALLY — they are explicitly labeled as fallback / holding, not
 * full coaching responses. Process #2 §10 routes these as terminal events,
 * not back through QC.
 */

export const FALLBACK_MAX_RETRIES = `Let me come back to you on this one. The version of an answer I have right now isn't quite landing in the way I'd want it to — and these matter too much to ship something half-baked.

Stay with the question. I'll be here when you write again.`;

export const FALLBACK_DEGRADED = `Something on my end isn't responding the way it should. I don't want to give you a worse answer than the question deserves — try me again in a few minutes.`;

export function fallbackMaxRetries(): string {
  return FALLBACK_MAX_RETRIES;
}

export function fallbackDegraded(): string {
  return FALLBACK_DEGRADED;
}
