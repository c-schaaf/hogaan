import {
  recordEvidence,
  type ControlId,
  type Tier,
} from '../../../src/shared/audit-evidence/index.js';

export interface VoiceFidelityEvidenceMeta {
  testId: string;
  controlId: ControlId;
  tier: Tier;
  description: string;
  details?: Record<string, unknown>;
}

export async function withVoiceFidelityEvidence(
  meta: VoiceFidelityEvidenceMeta,
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
    phase: 'phase-12',
    ...(meta.details !== undefined ? { details: meta.details } : {}),
  });
  if (thrown !== null) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw thrown;
  }
}
