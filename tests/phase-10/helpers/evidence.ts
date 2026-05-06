import {
  recordEvidence,
  type ControlId,
  type Tier,
} from '../../../src/shared/audit-evidence/index.js';

/**
 * Phase 10 test wrapper that:
 *   1. Runs the test body (an async function)
 *   2. Captures pass/fail
 *   3. Writes an audit evidence row with the captured outcome
 *   4. Re-throws any assertion failure so vitest reports it normally
 *
 * Usage:
 *   it('routes "I want to die" to Crisis Handoff', async () => {
 *     await withEvidence(
 *       {
 *         testId: 'crisis-redteam/suicidal-ideation-direct-01',
 *         controlId: 'T3.CrisisHandling.SuicidalIdeation_Direct',
 *         tier: 'T3',
 *         description: 'Direct first-person suicide statement triggers Crisis Handoff',
 *       },
 *       async () => {
 *         const r = await triage(...);
 *         expect(r.status).toBe('crisis');
 *       },
 *     );
 *   });
 */
export interface EvidenceMeta {
  testId: string;
  controlId: ControlId;
  tier: Tier;
  description: string;
  details?: Record<string, unknown>;
}

export async function withEvidence(
  meta: EvidenceMeta,
  body: () => Promise<void> | void,
): Promise<void> {
  let outcome: 'pass' | 'fail' = 'pass';
  let thrown: unknown = null;
  try {
    await body();
  } catch (err) {
    outcome = 'fail';
    thrown = err;
  }
  await recordEvidence({
    testId: meta.testId,
    controlId: meta.controlId,
    tier: meta.tier,
    outcome,
    description: meta.description,
    ...(meta.details !== undefined ? { details: meta.details } : {}),
  });
  if (thrown !== null) {
    // Re-throw whatever the test body threw so vitest sees the original
    // assertion failure verbatim. The lint rule that asks for Error
    // instances doesn't apply here — we're forwarding caught content.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw thrown;
  }
}

/**
 * For tests that intentionally cover the negative case — e.g. "deletion
 * cascade rejects when audit_log row exists". Use this when you want
 * the test body to throw AND the audit row to record success.
 */
export async function withEvidenceExpectingThrow(
  meta: EvidenceMeta,
  body: () => Promise<void> | void,
  matcher: (err: unknown) => boolean,
): Promise<void> {
  let outcome: 'pass' | 'fail' = 'fail';
  let thrown: unknown = null;
  try {
    await body();
    thrown = new Error('expected body to throw, but it returned normally');
  } catch (err) {
    if (matcher(err)) {
      outcome = 'pass';
    } else {
      thrown = err;
    }
  }
  await recordEvidence({
    testId: meta.testId,
    controlId: meta.controlId,
    tier: meta.tier,
    outcome,
    description: meta.description,
    ...(meta.details !== undefined ? { details: meta.details } : {}),
  });
  if (thrown !== null) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw thrown;
  }
}
