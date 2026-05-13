import type { ResolvedLibraries } from '../libraries/index.js';
import { reportIncident } from '../shared/observability/incidents.js';
import type { AppConfig } from '../shared/secrets/config.js';
import {
  check3SignatureStructure,
  // 🚨 PRE-LAUNCH RE-ENABLE: uncomment to restore the Check 8 safety gate.
  // check8SafetyCrisis,
  // Voice-shaping LLM graders below are disabled per 2026-05-13 trim.
  // Re-import to re-enable. See block comment on line ~30 for rationale.
  // check4AssetBased,
  // check7Tone,
  // check17PracticeGrounding,
  // checkTangibleAction,
  // checkUsefulToSocietyAnchor,
} from './checks-llm.js';
import {
  check1PracticeTag,
  check2LevelTag,
  check5HeroToGuide,
  check6UsefulToSociety,
  check9Length,
} from './checks-rule-based.js';
import { checkIntentLengthAsCheckResult } from './intent-length-bands.js';
// Check 10 (lived_experience), Check 11 (formatting_discipline), Check 13
// (voice_consistency), and Check 16 (level_fidelity) are intentionally NOT
// imported here. Check 13 and Check 16 were removed by the 2026-05-08 audit
// (graded hidden rules absent from the primary prompt). Check 10 and Check
// 11 were deactivated for the trusted-user pilot on 2026-05-08 — both are
// pure quality-shaping checks with no safety implication, and the same
// smoke trace that surfaced the Check 8 classifier JSON-trailer bug also
// surfaced an LLM-grader recalibration need on Check 10 and a
// regex-cleanliness need on Check 11. See
// audit-evidence/audits/2026-05-08-pre-launch-quality-check-deactivation.md
// for the deactivation record and reactivation criteria. Implementations
// (checkLivedExperienceDiscipline, checkFormattingDiscipline) are
// preserved for unit tests and future revival.
//
// 2026-05-13 voice-grader trim: Check 4 (asset_based), Check 7 (tone),
// Check 12 (tangible_action), Check 15 (useful_to_society_anchor), and
// Check 17 (practice_grounding) are additionally deactivated for the
// trusted-user pilot. Rationale: each adds ~4s of latency and ~$0.001 per
// turn; we lack user-feedback evidence that any of them catches drift
// real users notice. Re-enable on observed voice regression. Safety
// (Check 8, fail-closed) and structural arc (Check 3) remain on; rule-
// based checks (Checks 1, 2, 5, 6, 9, intent-length) are unaffected.
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
    //
    // Option B (2026-05-08): when the gate fires, dispatch is conditional
    // on the failure profile of `failingChecks`:
    //   - Check 8 service_unavailable in this batch: would have been caught
    //     by the early E6 fail-closed branch above (line ~115). Cannot be
    //     reached here; preserved as a defensive guard for future check
    //     additions.
    //   - any hard_fail present: E6 + fallbackDegraded(). Hard-failed
    //     responses are unshippable by definition.
    //   - only soft_fails: E8_ShipDegradedCandidate with the actual
    //     candidate as responseText + degraded:true + softFailedCheckIds
    //     populated. The user receives real coaching with a quality flag
    //     in the trace instead of the apology template — a single grader
    //     disagreement no longer replaces the response when the budget is
    //     exhausted. Safety semantics unchanged: Check 8 fail-closed and
    //     hard_fail E6 dispatch are both preserved.
    if (input.deadlineAt !== undefined) {
      const remainingMs = input.deadlineAt - Date.now();
      if (remainingMs < REGEN_BUDGET_HEADROOM_MS) {
        const hasHardFail = failingChecks.some((c) => c.outcome.status === 'hard_fail');
        const hasCheck8Unavailable = checks.some(
          (c) =>
            c.checkId === 'check_08_safety_crisis' && c.outcome.status === 'service_unavailable',
        );

        if (hasCheck8Unavailable || hasHardFail) {
          reportIncident('P2', 'QC regen skipped — remaining budget below regen headroom', {
            source: 'Process_10.RegenSkipBudget',
            extra: {
              retryCount,
              remainingMs,
              headroomMs: REGEN_BUDGET_HEADROOM_MS,
              failedChecks: failingChecks.map((c) => c.checkId),
              dispatch: 'E6_fallbackDegraded',
              reason: hasCheck8Unavailable ? 'check_08_unavailable' : 'hard_fail_present',
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

        // Only soft_fails — ship the candidate with a quality flag. This
        // is the Option B path: a likely-good response is no longer
        // replaced with an apology because the budget couldn't fit a
        // regen we probably didn't need.
        const softFailedCheckIds = failingChecks
          .filter((c) => c.outcome.status === 'soft_fail')
          .map((c) => c.checkId);
        reportIncident('P2', 'QC regen skipped — shipping candidate with quality flag (E8)', {
          source: 'Process_10.RegenSkipBudget',
          extra: {
            retryCount,
            remainingMs,
            headroomMs: REGEN_BUDGET_HEADROOM_MS,
            softFailedCheckIds,
            dispatch: 'E8_shipDegradedCandidate',
          },
        });
        return {
          endEvent: 'E8_ShipDegradedCandidate',
          responseText: candidate,
          crisisDetected: false,
          retryCount,
          degraded: true,
          checks,
          correctivePromptHistory,
          softFailedCheckIds,
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

/**
 * Run all active checks against the current candidate. Rule-based checks run
 * synchronously; LLM checks fan out in parallel for latency.
 *
 * Active set after the 2026-05-08 pre-launch deactivations (check_10 and
 * check_11) layered on top of the earlier 2026-05-08 audit removal of
 * check_13 / check_16: 6 sync checks (1, 2, 5, 6, 9, 14) + 7 parallel LLM
 * checks (3, 4, 7, 8, 12, 15, 17). Each LLM call has a 4s budget; wall-clock
 * for the full QC pass stays in the ~1.5s p95 envelope.
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
    checkIntentLengthAsCheckResult(candidate, input.intent),
  ];
  const llm = await Promise.all([
    check3SignatureStructure(deps.config, candidate),
    // ╔════════════════════════════════════════════════════════════════════╗
    // ║ 🚨🚨🚨  PRE-LAUNCH RE-ENABLE  —  CHECK 8 SAFETY GATE DISABLED  🚨🚨🚨 ║
    // ╠════════════════════════════════════════════════════════════════════╣
    // ║ Disabled 2026-05-13 (Muhsin) alongside the LLM-triage bypass for   ║
    // ║ latency measurement during the v0_unified rollout. Check 8 was the ║
    // ║ fail-closed second-line crisis + response-safety gate. With it     ║
    // ║ off, NO post-response safety check runs — every response Claude    ║
    // ║ emits ships to the user without an independent safety review.     ║
    // ║                                                                    ║
    // ║ Per CLAUDE.md hard rule #1 ("Crisis routing supersedes everything. ║
    // ║ Never bypass for cost, latency, or convenience"), this is NOT      ║
    // ║ acceptable for production launch.                                  ║
    // ║                                                                    ║
    // ║ TO RESTORE: uncomment the check8SafetyCrisis call below and the    ║
    // ║ matching import at the top of the file.                            ║
    // ╚════════════════════════════════════════════════════════════════════╝
    // check8SafetyCrisis(deps.config, input.userMessage, candidate),
    // Voice-shaping graders below disabled 2026-05-13 (see header note).
    // To re-enable: uncomment + restore imports from './checks-llm.js'.
    // check4AssetBased(deps.config, candidate),
    // check7Tone(deps.config, candidate),
    // checkTangibleAction(deps.config, candidate),
    // checkUsefulToSocietyAnchor(deps.config, candidate),
    // check17PracticeGrounding(deps.config, input.userMessage, candidate, input.predictedPracticeTag),
  ]);
  return [...sync, ...llm];
}
