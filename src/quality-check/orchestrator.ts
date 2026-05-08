import type { ResolvedLibraries } from '../libraries/index.js';
import { debugWarn } from '../shared/observability/debug-log.js';
import { reportIncident } from '../shared/observability/incidents.js';
import type { AppConfig } from '../shared/secrets/config.js';
import {
  check3SignatureStructure,
  check4AssetBased,
  check7Tone,
  check8SafetyCrisis,
  check17PracticeGrounding,
  checkLivedExperienceDiscipline,
  checkTangibleAction,
  checkUsefulToSocietyAnchor,
} from './checks-llm.js';
import {
  check1PracticeTag,
  check2LevelTag,
  check5HeroToGuide,
  check6UsefulToSociety,
  check9Length,
  checkFormattingDiscipline,
} from './checks-rule-based.js';
import { checkIntentLengthAsCheckResult } from './intent-length-bands.js';
// Check 13 (voice_consistency) and Check 16 (level_fidelity) are intentionally
// NOT imported here — see 2026-05-08 audit: both grade rules absent from the
// primary system prompt (embedding cosine vs unstated centroid; off-level
// phrase density formula). Implementations in voice-consistency.ts and
// checks-rule-based.ts (check16LevelFidelity) are preserved for unit tests
// and potential future revival as telemetry-only signals.
import { regenerate, REGEN_BUDGET_HEADROOM_MS } from './corrective.js';
import { fallbackDegraded, fallbackMaxRetries } from './fallbacks.js';
import type { CheckResult, QcInput, QcResult } from './types.js';
import { QcError } from './types.js';

const MAX_RETRIES = 3;

interface OrchestratorDeps {
  config: AppConfig;
  libraries: ResolvedLibraries;
  /**
   * Original system prompt that produced the candidate. Required for the
   * regeneration loop — caller (Process #2 §10) supplies the assembled prompt
   * from §8.
   */
  originalSystemPrompt: string;
}

/**
 * Process #10 orchestrator. Runs the 9 checks against the candidate,
 * regenerates on soft-fails up to MAX_RETRIES, and resolves to one of the
 * 7 terminal end events.
 *
 * Failure dispatch:
 *   - Check 8 'crisis' on ANY pass → bypass remaining checks, return E4 with
 *     crisisDetected=true. The caller (Process #2 §10) routes the original
 *     user message to Crisis Handoff.
 *   - Check 8 'hard_fail' → return E5 with the original (offensive) candidate
 *     blanked.
 *   - Check 8 'service_unavailable' → return E6 with degraded fallback
 *     (fail-closed for safety).
 *   - Any other check 'service_unavailable' → record but continue (treat as
 *     skip). Phase 7 instruments the alert path.
 *   - Any 'soft_fail' or 'hard_fail' on checks 1–7,9 → regenerate (up to
 *     MAX_RETRIES).
 *   - Retries exhausted → E3 with max-retries fallback message.
 *   - All pass on first attempt → E1.
 *   - All pass after ≥1 regen → E2.
 */
export async function runQualityCheck(deps: OrchestratorDeps, input: QcInput): Promise<QcResult> {
  if (typeof input.candidateResponseText !== 'string' || input.candidateResponseText.length === 0) {
    throw new QcError('candidateResponseText is required and non-empty', 'E7_MalformedInput');
  }
  if (typeof input.userMessage !== 'string' || input.userMessage.length === 0) {
    throw new QcError('userMessage is required and non-empty', 'E7_MalformedInput');
  }

  let candidate = input.candidateResponseText;
  let retryCount = 0;
  const correctivePromptHistory: string[] = [];

  while (true) {
    const checks = await runAllChecks(deps, input, candidate);

    // 1. Crisis short-circuit — bypass everything else.
    const crisis = checks.find((c) => c.outcome.status === 'crisis');
    if (crisis !== undefined) {
      return {
        endEvent: 'E4_CrisisEscalation',
        responseText: '',
        crisisDetected: true,
        retryCount,
        degraded: false,
        checks,
        correctivePromptHistory,
      };
    }

    // 2. Hard fail (Check 8 only — input/response is fundamentally unsafe).
    const hardSafetyFail = checks.find(
      (c) => c.checkId === 'check_08_safety_crisis' && c.outcome.status === 'hard_fail',
    );
    if (hardSafetyFail !== undefined) {
      return {
        endEvent: 'E5_SafetyHardFailure',
        responseText: '',
        crisisDetected: false,
        retryCount,
        degraded: false,
        checks,
        correctivePromptHistory,
      };
    }

    // 3. Safety classifier unavailable → fail-closed E6.
    const safetyUnavailable = checks.find(
      (c) => c.checkId === 'check_08_safety_crisis' && c.outcome.status === 'service_unavailable',
    );
    if (safetyUnavailable !== undefined) {
      reportIncident('P0', 'safety classifier unavailable — failing closed to E6', {
        source: 'Process_10.Check_08',
        extra: {
          retryCount,
          reason:
            safetyUnavailable.outcome.status === 'service_unavailable'
              ? safetyUnavailable.outcome.reason
              : '',
        },
      });
      return {
        endEvent: 'E6_ServiceUnavailable',
        responseText: fallbackDegraded(),
        crisisDetected: false,
        retryCount,
        degraded: true,
        checks,
        correctivePromptHistory,
      };
    }

    // 4. Other failures → regenerate.
    const failingChecks = checks.filter(
      (c) => c.outcome.status === 'soft_fail' || c.outcome.status === 'hard_fail',
    );

    if (failingChecks.length === 0) {
      // All pass.
      return {
        endEvent: retryCount === 0 ? 'E1_ApprovedFirstAttempt' : 'E2_ApprovedRegenerated',
        responseText: candidate,
        crisisDetected: false,
        retryCount,
        degraded: false,
        checks,
        correctivePromptHistory,
      };
    }

    // 5. Some checks failed; check retry budget.
    if (retryCount >= MAX_RETRIES) {
      reportIncident('P1', 'QC max-retries exceeded; returning fallback', {
        source: 'Process_10.MaxRetriesExceeded',
        extra: {
          retryCount,
          failedChecks: failingChecks.map((c) => c.checkId),
        },
      });
      return {
        endEvent: 'E3_MaxRetriesExceeded',
        responseText: fallbackMaxRetries(),
        crisisDetected: false,
        retryCount,
        degraded: false,
        checks,
        correctivePromptHistory,
      };
    }

    // R-07 — predictive budget gate. Skip regen if the remaining budget is
    // smaller than REGEN_BUDGET_HEADROOM_MS, i.e. we cannot guarantee the
    // regen + final QC pass + delivery will fit before LATENCY_BUDGET_MS.
    //
    // The previous implementation used a reactive predicate (skip if the
    // deadline was already past) and fired AFTER the budget was already
    // gone. A regen permitted with only a few seconds of remaining budget
    // is allowed to take up to REGEN_TIMEOUT_MS (10s), then the final QC
    // pass adds ~1.5s, then delivery adds ~0.5s — pushing the total turn
    // well past LATENCY_BUDGET_MS. The R-06 gate in the coaching
    // orchestrator then dispatches FALLBACK_DEGRADED at ~19s elapsed, and
    // the user waits 19s only to receive a degraded response.
    //
    // The predictive form ships fallback at ~10s elapsed instead, freeing
    // the user from the dead-budget wait, AND avoids spending compute on
    // a regen that cannot be delivered. See
    // audit-evidence/phase-12/2026-05-08 RCA for the trace evidence.
    if (input.deadlineAt !== undefined) {
      const remainingMs = input.deadlineAt - Date.now();
      if (remainingMs < REGEN_BUDGET_HEADROOM_MS) {
        reportIncident('P2', 'QC regen skipped — remaining budget below regen headroom', {
          source: 'Process_10.RegenSkipBudget',
          extra: {
            retryCount,
            remainingMs,
            headroomMs: REGEN_BUDGET_HEADROOM_MS,
            failedChecks: failingChecks.map((c) => c.checkId),
          },
        });
        return {
          endEvent: 'E6_ServiceUnavailable',
          responseText: fallbackDegraded(),
          crisisDetected: false,
          retryCount,
          degraded: true,
          checks,
          correctivePromptHistory,
        };
      }
    }

    // 6. Build corrective prompt and regenerate.
    const regenResult = await regenerate(deps.config, {
      originalSystemPrompt: deps.originalSystemPrompt,
      userMessage: input.userMessage,
      failedCandidate: candidate,
      failedChecks: failingChecks,
    });

    if ('error' in regenResult) {
      reportIncident('P1', 'QC regenerate call failed; returning degraded fallback', {
        source: 'Process_10.Regenerate',
        extra: { retryCount, error: regenResult.error },
      });
      return {
        endEvent: 'E6_ServiceUnavailable',
        responseText: fallbackDegraded(),
        crisisDetected: false,
        retryCount,
        degraded: true,
        checks,
        correctivePromptHistory,
      };
    }

    correctivePromptHistory.push(
      failingChecks
        .map((c) =>
          c.outcome.status === 'soft_fail' || c.outcome.status === 'hard_fail'
            ? `${c.checkId}: ${c.outcome.reason}`
            : c.checkId,
        )
        .join(' | '),
    );
    candidate = regenResult.text;
    retryCount += 1;
  }
}

type CheckTelemetry = {
  checkId: string;
  status: string;
  latencyMs: number;
  reason?: string;
};

const telemetry: WeakMap<CheckResult, CheckTelemetry> = new WeakMap();

function parseReason(reason: string): { errName: string; errMessage: string } {
  const i = reason.indexOf(': ');
  return i > 0
    ? { errName: reason.slice(0, i), errMessage: reason.slice(i + 2) }
    : { errName: '', errMessage: reason };
}

async function instrumentCheck(
  checkId: string,
  fn: () => Promise<CheckResult>,
): Promise<CheckResult> {
  debugWarn('QC-CHECK', `${checkId} start`, { checkId });
  const t0 = Date.now();
  const result = await fn();
  const latencyMs = Date.now() - t0;
  const status = result.outcome.status;
  if (result.outcome.status === 'service_unavailable') {
    const reason = result.outcome.reason;
    const { errName, errMessage } = parseReason(reason);
    debugWarn('QC-CHECK', `${checkId} done`, {
      checkId,
      status,
      latencyMs,
      errName,
      errMessage,
      reason,
    });
    telemetry.set(result, { checkId, status, latencyMs, reason });
  } else {
    debugWarn('QC-CHECK', `${checkId} done`, { checkId, status, latencyMs });
    telemetry.set(result, { checkId, status, latencyMs });
  }
  return result;
}

function instrumentCheckSync(checkId: string, fn: () => CheckResult): CheckResult {
  debugWarn('QC-CHECK', `${checkId} start`, { checkId });
  const t0 = Date.now();
  const result = fn();
  const latencyMs = Date.now() - t0;
  debugWarn('QC-CHECK', `${checkId} done`, {
    checkId,
    status: result.outcome.status,
    latencyMs,
  });
  return result;
}

/**
 * Run all active checks against the current candidate. Rule-based checks run
 * synchronously; LLM checks fan out in parallel for latency.
 *
 * Active set after 2026-05-08 audit removal of check_13 (voice_consistency)
 * and check_16 (level_fidelity): 7 sync checks (1, 2, 5, 6, 9, 11, 14) + 8
 * parallel LLM checks (3, 4, 7, 8, 10, 12, 15, 17). Each LLM call has a 4s
 * budget; wall-clock for the full QC pass stays in the ~1.5s p95 envelope.
 *
 * Note: even though Check 8 is the most consequential, we still run all checks
 * concurrently so we get the full failure picture in one round-trip — Check 8
 * has its own 4s budget so won't block the orchestrator past that.
 */
async function runAllChecks(
  deps: OrchestratorDeps,
  input: QcInput,
  candidate: string,
): Promise<CheckResult[]> {
  const sync: CheckResult[] = [
    check1PracticeTag(input.predictedPracticeTag),
    check2LevelTag(input.predictedLevelTag),
    check5HeroToGuide(deps.libraries.voiceRules.payload, candidate),
    check6UsefulToSociety(deps.libraries.voiceRules.payload, candidate, input.predictedLevelTag),
    check9Length(candidate, input.responseMode),
    instrumentCheckSync('check_11_formatting_discipline', () =>
      checkFormattingDiscipline(candidate),
    ),
    checkIntentLengthAsCheckResult(candidate, input.intent),
  ];
  const llm = await Promise.all([
    instrumentCheck('check_03_signature_structure', () =>
      check3SignatureStructure(deps.config, candidate),
    ),
    instrumentCheck('check_04_asset_based', () => check4AssetBased(deps.config, candidate)),
    instrumentCheck('check_07_tone', () => check7Tone(deps.config, candidate)),
    instrumentCheck('check_08_safety_crisis', () =>
      check8SafetyCrisis(deps.config, input.userMessage, candidate),
    ),
    instrumentCheck('check_10_lived_experience', () =>
      checkLivedExperienceDiscipline(deps.config, candidate),
    ),
    instrumentCheck('check_12_tangible_action', () => checkTangibleAction(deps.config, candidate)),
    instrumentCheck('check_15_useful_to_society_anchor', () =>
      checkUsefulToSocietyAnchor(deps.config, candidate),
    ),
    // Batch P Piece 3 — LLM-judged practice grounding (parallel batch).
    instrumentCheck('check_17_practice_grounding', () =>
      check17PracticeGrounding(deps.config, input.userMessage, candidate, input.predictedPracticeTag),
    ),
  ]);

  let passCount = 0;
  let softFailCount = 0;
  let hardFailCount = 0;
  let serviceUnavailableCount = 0;
  let slowestCheck: { id: string; latencyMs: number } = { id: '', latencyMs: -1 };
  let slowestErrorCheck: { id: string; err: string; latencyMs: number } | null = null;
  for (const r of llm) {
    const t = telemetry.get(r);
    if (t === undefined) continue;
    if (t.status === 'pass') passCount += 1;
    else if (t.status === 'soft_fail') softFailCount += 1;
    else if (t.status === 'hard_fail') hardFailCount += 1;
    else if (t.status === 'service_unavailable') serviceUnavailableCount += 1;
    if (t.latencyMs > slowestCheck.latencyMs) {
      slowestCheck = { id: t.checkId, latencyMs: t.latencyMs };
    }
    if (t.status === 'service_unavailable') {
      if (slowestErrorCheck === null || t.latencyMs > slowestErrorCheck.latencyMs) {
        slowestErrorCheck = { id: t.checkId, err: t.reason ?? '', latencyMs: t.latencyMs };
      }
    }
  }
  debugWarn('QC-CHECK', 'parallel batch summary', {
    scope: 'parallel',
    totalChecks: llm.length,
    passCount,
    softFailCount,
    hardFailCount,
    serviceUnavailableCount,
    slowestCheck,
    slowestErrorCheck,
  });

  return [...sync, ...llm];
}
