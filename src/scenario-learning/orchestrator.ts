import { reportP1, reportP2 } from '../incident-handling/index.js';
import { getActiveLibraryVersions } from '../libraries/index.js';
import type { Scenario, ScenarioStep } from '../libraries/types.js';
import { assemblePrompt } from '../prompt-assembly/index.js';
import { runQualityCheck } from '../quality-check/index.js';
import type { Database } from '../shared/db/client.js';
import { chat } from '../shared/llm/chat.js';
import { isFailClosedLlmError } from '../shared/llm/errors.js';
import type { RedisBundle } from '../shared/redis/client.js';
import type { RateLimiters } from '../shared/redis/rate-limit.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { type PhoneE164, type SessionId, type UserId } from '../shared/types/index.js';
import { selectScenario } from './select.js';
import {
  abandonScenario,
  advanceStep,
  completeScenario,
  loadScenarioState,
  startScenario,
  type ActiveScenarioState,
} from './state.js';

/**
 * Phase 8B — scenario orchestrator. Called from Process #2 Step 4 when:
 *
 *   - the user has an `activeScenario` on their profile (continuation), OR
 *   - the user's intent classified to ScenarioRequest (kickoff).
 *
 * Multi-turn flow:
 *
 *   kickoff: select scenario → start state → send step 1 coachPrompt verbatim
 *   step >= 2: assemble ScenarioRolePlay prompt with prior step + criteria +
 *              upcoming script attached → LLM → QC → send → advance state
 *   final step replied to: LLM evaluates + writes closing reflection → mark
 *                          scenarioId as completed on the profile
 *
 * "Exit" / "stop" / "quit" / "cancel" / "abandon" said by the user during an
 * active scenario abandons the scenario and returns control to coaching.
 */

interface ScenarioDeps {
  config: AppConfig;
  db: Database;
  redis: RedisBundle;
  rateLimiters: RateLimiters;
}

export interface ScenarioInbound {
  userId: UserId;
  phoneE164: PhoneE164;
  body: string;
  sessionId: SessionId;
}

export type ScenarioTurnOutcome =
  | { kind: 'kickoff_sent'; scenarioId: string; step: number; responseText: string }
  | {
      kind: 'step_completed';
      scenarioId: string;
      stepCompleted: number;
      nextStep: number | null;
      responseText: string;
    }
  | { kind: 'scenario_completed'; scenarioId: string; responseText: string }
  | { kind: 'abandoned'; scenarioId: string; responseText: string }
  | { kind: 'no_active_scenario_no_kickoff' }
  | { kind: 'failed'; reason: string };

// Phase 12 R19 — single-word abandon keywords (exit/abort/quit) match on
// word boundary so "exits the building" doesn't trip. The multi-word
// keywords (exit scenario / stop scenario / etc.) match as substrings.
//
// Precedence: webhook-router R17 honors global STOP/UNSUBSCRIBE/etc. before
// reaching scenario logic. So a user typing STOP during a scenario opts out
// entirely; only single-word exit/abort/quit (and the multi-word phrases)
// land here.
const ABANDON_PHRASES = [
  'exit scenario',
  'stop scenario',
  'quit scenario',
  'cancel scenario',
  'end scenario',
  'abandon scenario',
  'leave scenario',
];
const ABANDON_SINGLE_WORDS = ['exit', 'abort', 'quit'];
const ABANDON_TEMPLATE =
  "Exited the scenario. We're back in regular coaching mode — what's on your mind?";

export async function runScenarioTurn(
  deps: ScenarioDeps,
  inbound: ScenarioInbound,
  /** Pass true when Process #2 routed this here because intent=ScenarioRequest. */
  isScenarioRequestKickoff: boolean,
): Promise<ScenarioTurnOutcome> {
  const state = await loadScenarioState(deps.db, inbound.userId);

  // Active scenario + abandonment keyword → exit gracefully.
  if (state.active !== null && isAbandonRequest(inbound.body)) {
    await abandonScenario(deps.db, inbound.userId);
    await sendBody(deps, inbound, ABANDON_TEMPLATE, 'scenario:abandon');
    return {
      kind: 'abandoned',
      scenarioId: state.active.scenarioId,
      responseText: ABANDON_TEMPLATE,
    };
  }

  // Continuation path — user replied to a step.
  if (state.active !== null) {
    return await advanceActiveScenario(deps, inbound, state.active);
  }

  // Kickoff path — user requested a scenario but doesn't have one running.
  if (isScenarioRequestKickoff) {
    return await kickoffNewScenario(deps, inbound, state.completed);
  }

  return { kind: 'no_active_scenario_no_kickoff' };
}

async function kickoffNewScenario(
  deps: ScenarioDeps,
  inbound: ScenarioInbound,
  completedScenarioIds: string[],
): Promise<ScenarioTurnOutcome> {
  const libs = await getActiveLibraryVersions(deps.db);
  const selection = selectScenario({
    message: inbound.body,
    scenarios: libs.scenarios.payload.scenarios,
    completedScenarioIds,
  });
  if (selection === null) {
    reportP1('scenario kickoff failed — no scenarios in active library', {
      source: 'Phase8B.ScenarioOrchestrator',
      extra: { userId: inbound.userId },
    });
    return { kind: 'failed', reason: 'no scenarios in active library' };
  }

  const scenario = selection.scenario;
  const firstStep = scenario.steps[0];
  if (firstStep === undefined) {
    reportP1('scenario has zero steps', {
      source: 'Phase8B.ScenarioOrchestrator',
      tags: { scenarioId: scenario.id },
    });
    return { kind: 'failed', reason: `scenario ${scenario.id} has zero steps` };
  }

  await startScenario(deps.db, inbound.userId, scenario.id);

  const opener = composeKickoffMessage(scenario, firstStep);
  const sent = await sendBody(deps, inbound, opener, `scenario:${scenario.id}:start`);
  if (sent.failed) {
    reportP1('scenario opener delivery failed', {
      source: 'Phase8B.ScenarioOrchestrator',
      tags: { scenarioId: scenario.id },
    });
    // Don't unwind state — the scenario is started; user can retry messaging.
    return { kind: 'failed', reason: 'delivery failed' };
  }

  return {
    kind: 'kickoff_sent',
    scenarioId: scenario.id,
    step: 1,
    responseText: opener,
  };
}

async function advanceActiveScenario(
  deps: ScenarioDeps,
  inbound: ScenarioInbound,
  active: ActiveScenarioState,
): Promise<ScenarioTurnOutcome> {
  const libs = await getActiveLibraryVersions(deps.db);
  const scenario = libs.scenarios.payload.scenarios.find((s) => s.id === active.scenarioId);
  if (scenario === undefined) {
    // Active scenario no longer exists in the library (version flip mid-run).
    // Best move: abandon, fall back to coaching.
    await abandonScenario(deps.db, inbound.userId);
    reportP2('active scenario not found in current library — abandoning', {
      source: 'Phase8B.ScenarioOrchestrator',
      tags: { scenarioId: active.scenarioId },
      extra: { userId: inbound.userId },
    });
    const msg =
      "That scenario isn't available anymore — we're back in coaching mode. What's on your mind?";
    await sendBody(deps, inbound, msg, 'scenario:lib-missing');
    return { kind: 'abandoned', scenarioId: active.scenarioId, responseText: msg };
  }

  const currentStepIdx = active.currentStep - 1;
  const currentStep = scenario.steps[currentStepIdx];
  if (currentStep === undefined) {
    // State drift — currentStep > steps.length. Mark complete defensively.
    await completeScenario(deps.db, inbound.userId, scenario.id);
    return { kind: 'scenario_completed', scenarioId: scenario.id, responseText: '' };
  }

  const isFinalStep = active.currentStep >= scenario.steps.length;
  const nextStep = isFinalStep ? null : (scenario.steps[currentStepIdx + 1] ?? null);

  // Compose the scenario context that goes into the userMessage block.
  const userMessageWithContext = composeStepUserMessage(
    scenario,
    currentStep,
    nextStep,
    isFinalStep,
    inbound.body,
  );

  // Assemble prompt under ScenarioRolePlay mode.
  let promptBundle;
  try {
    promptBundle = await assemblePrompt(deps.config, deps.db, {
      userId: inbound.userId,
      sessionId: inbound.sessionId,
      responseMode: 'ScenarioRolePlay',
      practiceTag: scenario.practice,
      levelTag: scenario.level,
      userMessage: userMessageWithContext,
      userProfile: {},
      retrievedMemories: [],
      sessionTurns: [],
    });
  } catch (err) {
    reportP1('scenario prompt assembly failed', {
      source: 'Phase8B.ScenarioOrchestrator',
      tags: { scenarioId: scenario.id, step: String(active.currentStep) },
      extra: { error: err instanceof Error ? err.message : String(err) },
    });
    return { kind: 'failed', reason: 'prompt assembly failed' };
  }

  // LLM call.
  let chatResp;
  try {
    chatResp = await chat(
      deps.config,
      {
        systemPrompt: promptBundle.assembledPrompt,
        messages: [{ role: 'user', content: inbound.body }],
        maxTokens: 400,
        temperature: 0.5,
      },
      "Let's pause this scenario for now — we can pick it back up later.",
    );
  } catch (err) {
    if (isFailClosedLlmError(err)) {
      reportP1('scenario LLM call failed (fail-closed)', {
        source: 'Phase8B.ScenarioOrchestrator',
        tags: { scenarioId: scenario.id, step: String(active.currentStep) },
        extra: { error: err instanceof Error ? err.message : String(err) },
      });
      return { kind: 'failed', reason: 'llm service unavailable' };
    }
    throw err;
  }

  // QC.
  const qc = await runQualityCheck(
    {
      config: deps.config,
      libraries: libs,
      originalSystemPrompt: promptBundle.assembledPrompt,
    },
    {
      candidateResponseText: chatResp.text,
      userMessage: inbound.body,
      responseMode: 'ScenarioRolePlay',
      intent: 'ScenarioRequest',
      predictedPracticeTag: scenario.practice,
      predictedLevelTag: scenario.level,
      userId: inbound.userId,
      sessionId: inbound.sessionId,
    },
  );

  if (qc.endEvent === 'E5_SafetyHardFailure' || qc.endEvent === 'E4_CrisisEscalation') {
    // Crisis branch: leave scenario in place; the coaching orchestrator routed
    // us here from intent=Coaching/ScenarioRequest before triage saw a crisis,
    // but Check 8 caught it on the LLM output. We return failed so the caller
    // surfaces the crisis-handoff path. For Phase A, we keep this simple —
    // crisis during a scenario is rare; we abandon the scenario and surface.
    await abandonScenario(deps.db, inbound.userId);
    return { kind: 'failed', reason: `qc:${qc.endEvent}` };
  }

  const responseText = qc.responseText;
  const sent = await sendBody(
    deps,
    inbound,
    responseText,
    `scenario:${scenario.id}:step${active.currentStep}`,
  );
  if (sent.failed) {
    return { kind: 'failed', reason: 'delivery failed' };
  }

  // Advance state.
  if (isFinalStep) {
    await completeScenario(deps.db, inbound.userId, scenario.id);
    return { kind: 'scenario_completed', scenarioId: scenario.id, responseText };
  }
  await advanceStep(deps.db, inbound.userId, active.currentStep + 1);
  return {
    kind: 'step_completed',
    scenarioId: scenario.id,
    stepCompleted: active.currentStep,
    nextStep: active.currentStep + 1,
    responseText,
  };
}

function composeKickoffMessage(scenario: Scenario, firstStep: ScenarioStep): string {
  return [`Scenario: ${scenario.title}.`, scenario.pitch, '', firstStep.coachPrompt].join('\n');
}

/**
 * Build the userMessage payload sent into the ScenarioRolePlay prompt
 * assembly. We embed a SCENARIO CONTEXT header so the LLM (which already has
 * the scenario_rolePlay_v1 system text) can evaluate against the correct
 * step's criteria and know the next step's coachPrompt to set up.
 */
function composeStepUserMessage(
  scenario: Scenario,
  currentStep: ScenarioStep,
  nextStep: ScenarioStep | null,
  isFinalStep: boolean,
  actualUserReply: string,
): string {
  const lines: string[] = [];
  lines.push(
    `[SCENARIO CONTEXT — id=${scenario.id} step=${currentStep.step}/${scenario.steps.length}]`,
  );
  lines.push(`Practice: ${scenario.practice}; Level: ${scenario.level}.`);
  lines.push('');
  lines.push(`The step you previously set up was:`);
  lines.push(`> ${currentStep.coachPrompt}`);
  lines.push('');
  lines.push(`Evaluate the user's reply (below) against these criteria:`);
  for (const c of currentStep.evaluationCriteria) {
    lines.push(`- ${c}`);
  }
  lines.push('');
  if (isFinalStep) {
    lines.push(
      `This was the FINAL step. After your evaluation, write a brief closing reflection on what they practiced and how it might show up in their work this week.`,
    );
    lines.push(`Completion criteria: ${scenario.completionCriteria}`);
  } else if (nextStep !== null) {
    lines.push(`If criteria are met, set up the next step:`);
    lines.push(`> ${nextStep.coachPrompt}`);
    lines.push(
      `If criteria are NOT met, gently invite the user to try the current step again — name what was missing without becoming a critic.`,
    );
  }
  lines.push('');
  lines.push(`User reply:`);
  lines.push(actualUserReply);
  return lines.join('\n');
}

// Response is returned via HTTP on the web channel — no outbound dispatch.
function sendBody(
  _deps: ScenarioDeps,
  _inbound: ScenarioInbound,
  _body: string,
  _callerSubId: string,
): Promise<{ failed: boolean }> {
  return Promise.resolve({ failed: false });
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  for (const n of needles) {
    if (haystack.includes(n)) {
      return true;
    }
  }
  return false;
}

/**
 * Phase 12 R19 — abandon detection.
 *
 * Multi-word phrases ("exit scenario") match as substrings. Single-word
 * tokens (exit/abort/quit) match only on word boundary so common phrases
 * like "exits the building" or "the team quit on me" don't accidentally
 * end the scenario.
 *
 * Note: STOP/UNSUBSCRIBE/etc. is handled at webhook-router (R17) and never
 * reaches here — that path opts the user out entirely.
 */
export function isAbandonRequest(text: string): boolean {
  const norm = text
    .toLowerCase()
    .trim()
    .replace(/[!?.,]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (norm.length === 0) {
    return false;
  }
  if (containsAny(norm, ABANDON_PHRASES)) {
    return true;
  }
  for (const w of ABANDON_SINGLE_WORDS) {
    if (norm === w) {
      return true;
    }
    const re = new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, 'i');
    if (re.test(norm)) {
      return true;
    }
  }
  return false;
}
