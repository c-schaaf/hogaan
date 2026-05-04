import type { ResolvedLibraries } from '../libraries/index.js';
import { reportIncident } from '../shared/observability/incidents.js';
import type { AppConfig } from '../shared/secrets/config.js';
import {
  check3SignatureStructure,
  check4AssetBased,
  check7Tone,
  check8SafetyCrisis,
} from './checks-llm.js';
import {
  check1PracticeTag,
  check2LevelTag,
  check5HeroToGuide,
  check6UsefulToSociety,
  check9Length,
} from './checks-rule-based.js';
import { regenerate } from './corrective.js';
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
 * Run all 9 checks against the current candidate. Rule-based checks run
 * synchronously; LLM checks fan out in parallel for latency.
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
  ];
  const llm = await Promise.all([
    check3SignatureStructure(deps.config, candidate),
    check4AssetBased(deps.config, candidate),
    check7Tone(deps.config, candidate),
    check8SafetyCrisis(deps.config, input.userMessage, candidate),
  ]);
  return [...sync, ...llm];
}
