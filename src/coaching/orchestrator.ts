import { randomUUID } from 'node:crypto';
import { handoff as crisisHandoff } from '../crisis-handoff/index.js';
import { reportP1 } from '../incident-handling/index.js';
import { getActiveLibraryVersions } from '../libraries/index.js';
import { assemblePrompt, PromptAssemblyError } from '../prompt-assembly/index.js';
import { runQualityCheck } from '../quality-check/index.js';
import { fallbackDegraded } from '../quality-check/fallbacks.js';
import { runScenarioTurn } from '../scenario-learning/index.js';
import { resolveSession } from '../session-lifecycle/index.js';
import type { Database } from '../shared/db/client.js';
import {
  LlmContentFilterError,
  LlmServiceUnavailableError,
  isFailClosedLlmError,
} from '../shared/llm/errors.js';
import { chat } from '../shared/llm/chat.js';
import type { RedisBundle } from '../shared/redis/client.js';
import type { RateLimiters } from '../shared/redis/rate-limit.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { BRAND_FRAMEWORK_ATTRIBUTION } from '../shared/brand/constants.js';
import { hashPhone } from '../shared/db/encryption.js';
import { emitTurnTrace, type TraceEmitter } from '../shared/trace/index.js';
import {
  asCorrelationId,
  type LevelTag,
  type PracticeTag,
  type TurnId,
} from '../shared/types/index.js';
import { sendOutbound } from '../whatsapp-delivery/orchestrator.js';
import { fetchCoachingContext } from './context-fetch.js';
import { decideContinuation } from './continuation.js';
import type { CoachingEndEvent } from './end-events.js';
import { persistPostTurn, persistShortCircuitTurn } from './post-turn.js';
import { tagPracticeAndLevel } from './tagger.js';
import { triage } from './triage.js';
import type { CoachingInbound, CoachingTurnResult, TriageResult } from './types.js';

interface CoachingDeps {
  config: AppConfig;
  db: Database;
  redis: RedisBundle;
  rateLimiters: RateLimiters;
  traceEmitter: TraceEmitter;
}

const SAFE_TEMPLATE = `That topic isn't something I can help with from a coaching seat. If it's a leadership challenge underneath, tell me what's at stake for your team and I'll meet you there.`;
const REJECT_TEMPLATE = `That message lands outside what I can help with. If you have a leadership challenge — a hard conversation, a stuck team, a decision under pressure — that's where I'm built to be useful.`;
const META_TEMPLATE = `I'm Hogaan — a coaching presence anchored in ${BRAND_FRAMEWORK_ATTRIBUTION}. I'm an AI built around his voice, sponsor-funded for users in the Horn of Africa. I work text-only for now: send me a leadership challenge and I'll respond.`;
const PROFILE_ACK_TEMPLATE = `Heard. I've noted that update — I'll show up with it in mind next time. Send a leadership question whenever you're ready.`;
const MEDIA_REJECT_TEMPLATE = `I work with text only for now. Type out what's on your mind and I'll respond.`;
// R16 — short-circuit templates for low-content intents. Each ≤80 words,
// no LLM, no prompt assembly, no QC. Cuts the per-turn cost on greetings
// and affirmations to a single Twilio send.
const GREETING_RESPONSE = `Salaam. I'm Hogaan, here when you have a leadership challenge to think through — a hard conversation, a stuck team, a decision under pressure. Tell me what's on your mind.`;
const AFFIRMATION_RESPONSE = `Glad it landed. I'm here when the next thing surfaces.`;

/**
 * Process #2 — Coaching Conversation orchestrator. Implements the full BPMN.
 *
 * Latency budget: total turn p99 ≤ 6s. Primary LLM cap 5s. Triage
 * (parallel keyword + Groq, ~1s p99). Context fetch ~250ms. QC ~1s.
 * Worst case: 1s triage + 250ms context + 5s primary + 1s QC = ~7.25s in
 * extreme cases — caller must accept that the budget is a target, not a
 * hard SLA.
 */
export async function runCoachingTurn(
  deps: CoachingDeps,
  inbound: CoachingInbound,
): Promise<CoachingTurnResult> {
  const t0 = Date.now();
  const userIdHash = hashPhone(inbound.phoneE164);

  // ---- Step 1: triage + crisis ---------------------------------------
  const triageResult = await triage(deps.config, inbound.body, inbound.mediaUrls);

  if (triageResult.status === 'crisis') {
    return await handleCrisis(deps, inbound, triageResult, t0);
  }
  if (triageResult.status === 'empty') {
    return finalize(deps, inbound, {
      endEvent: 'E12_SilentDrop',
      responseText: '',
      practiceTag: null,
      levelTag: null,
      latencyMs: Date.now() - t0,
      reason: 'inbound was empty',
      sessionId: 'pending',
      turnId: null,
    });
  }
  if (triageResult.status === 'media_only') {
    await sendBody(deps, inbound, MEDIA_REJECT_TEMPLATE, 'media-reject');
    return finalize(deps, inbound, {
      endEvent: 'E8_MediaNotSupported',
      responseText: MEDIA_REJECT_TEMPLATE,
      practiceTag: null,
      levelTag: null,
      latencyMs: Date.now() - t0,
      reason: 'inbound media only',
      sessionId: 'pending',
      turnId: null,
    });
  }
  if (triageResult.status === 'reject') {
    await sendBody(deps, inbound, REJECT_TEMPLATE, 'message-reject');
    return finalize(deps, inbound, {
      endEvent: 'E9_MessageRejected',
      responseText: REJECT_TEMPLATE,
      practiceTag: null,
      levelTag: null,
      latencyMs: Date.now() - t0,
      reason: triageResult.reason,
      sessionId: 'pending',
      turnId: null,
    });
  }

  const intent = triageResult.intent ?? 'Coaching';

  // ---- Step 2: session state -----------------------------------------
  const session = await resolveSession(deps.db, {
    userId: inbound.userId,
    now: inbound.receivedAt,
  });

  // ---- Step 4 (pre): scenario routing --------------------------------
  // An active scenario takes precedence over intent: if the user is mid-
  // scenario, their reply belongs to the scenario flow regardless of how
  // the intent classifier labeled it. ScenarioRequest with no active
  // scenario kicks off a new one.
  const scenarioOutcome = await runScenarioTurn(
    {
      config: deps.config,
      db: deps.db,
      redis: deps.redis,
      rateLimiters: deps.rateLimiters,
    },
    {
      userId: inbound.userId,
      phoneE164: inbound.phoneE164,
      body: inbound.body,
      sessionId: session.sessionId,
    },
    intent === 'ScenarioRequest',
  );
  if (scenarioOutcome.kind !== 'no_active_scenario_no_kickoff') {
    return finalize(deps, inbound, {
      endEvent: 'E4_ScenarioHandoff',
      responseText: 'responseText' in scenarioOutcome ? scenarioOutcome.responseText : '',
      practiceTag: null,
      levelTag: null,
      latencyMs: Date.now() - t0,
      reason: `scenario_${scenarioOutcome.kind}`,
      sessionId: session.sessionId,
      turnId: null,
    });
  }

  // ---- Step 4: intent router (sub-flows for non-coaching intents) ----
  // R16 — Greeting / Affirmation / MetaQuestion / ProfileUpdate are templated
  // short-circuits. They never hit the tagger, prompt assembly, or the LLM,
  // so a "hi" or "thanks" costs roughly nothing per turn (Twilio send only).
  // The previous behavior ran the full coaching pipeline on greetings, which
  // (a) wasted the latency budget and (b) regularly produced robotic
  // pseudo-coaching replies to "salaam" — both audit findings.
  if (intent === 'MetaQuestion') {
    return await runTemplatedResponse(
      deps,
      inbound,
      session.sessionId,
      META_TEMPLATE,
      'meta',
      'E6_MetaResponse',
      t0,
      'MetaQuestion',
    );
  }
  if (intent === 'ProfileUpdate') {
    return await runTemplatedResponse(
      deps,
      inbound,
      session.sessionId,
      PROFILE_ACK_TEMPLATE,
      'profile-ack',
      'E5_ProfileAck',
      t0,
      'ProfileUpdate',
    );
  }
  // R-01 — only fire on a genuinely new session. Mid-session courtesy
  // beats classified as Greeting fall through to the coaching path.
  if (intent === 'Greeting' && session.isNew) {
    return await runTemplatedResponse(
      deps,
      inbound,
      session.sessionId,
      GREETING_RESPONSE,
      'greeting',
      'E1_TurnCompleted',
      t0,
      'Greeting',
    );
  }
  // R-01 — only fire when there's a prior turn to acknowledge. New
  // sessions classified as Affirmation are still openings, not closings;
  // fall through to the coaching path.
  if (intent === 'Affirmation' && !session.isNew && session.turnCount > 0) {
    return await runTemplatedResponse(
      deps,
      inbound,
      session.sessionId,
      AFFIRMATION_RESPONSE,
      'affirmation',
      'E1_TurnCompleted',
      t0,
      'Affirmation',
    );
  }

  // ClarificationResponse / Coaching share the main coaching path.

  // ---- Step 5: parallel context fetch --------------------------------
  const ctx = await fetchCoachingContext(
    { config: deps.config, db: deps.db },
    {
      userId: inbound.userId,
      sessionId: session.sessionId,
      query: inbound.body,
    },
  );

  // ---- Step 6: practice + level tagging ------------------------------
  const tags = tagPracticeAndLevel(inbound.body, ctx.profile.mappedPractices ?? []);

  // ---- Step 7: clarification decision (v1: skip — always advance) ----

  // ---- Step 8: prompt assembly ---------------------------------------
  // R-04 — wrap in try/catch. PromptAssemblyError must finalize as
  // E11_ServiceUnavailable + dispatch FALLBACK_DEGRADED so the user
  // receives a response instead of the queue-processor dead-lettering
  // a silent failure. Unknown errors rethrow (preserve bug-report semantics).
  let promptBundle;
  try {
    promptBundle = await assemblePrompt(deps.config, deps.db, {
      userId: inbound.userId,
      sessionId: session.sessionId,
      responseMode: 'FullCoachingResponse',
      practiceTag: tags.practiceTag,
      levelTag: tags.levelTag,
      secondaryPracticeTag: tags.secondaryPracticeTag,
      secondaryLevelTag: tags.secondaryLevelTag,
      taggerConfidence: tags.confidence,
      userMessage: inbound.body,
      userProfile: ctx.profile,
      retrievedMemories: ctx.memories,
      sessionTurns: ctx.sessionTurns,
    });
  } catch (err) {
    if (err instanceof PromptAssemblyError) {
      const body = fallbackDegraded();
      await sendBody(deps, inbound, body, 'prompt-assembly-failure');
      return finalize(deps, inbound, {
        endEvent: 'E11_ServiceUnavailable',
        responseText: body,
        practiceTag: tags.practiceTag,
        levelTag: tags.levelTag,
        latencyMs: Date.now() - t0,
        reason: `prompt-assembly: ${err.endEvent}`,
        sessionId: session.sessionId,
        turnId: null,
      });
    }
    throw err;
  }

  // ---- Step 9: primary LLM call --------------------------------------
  let chatResp;
  try {
    chatResp = await chat(
      deps.config,
      {
        systemPrompt: promptBundle.assembledPrompt,
        messages: [{ role: 'user', content: inbound.body }],
        maxTokens: 512,
        // R15 — was 0.4. The audit found 0.4 produced too much variation
        // run-to-run on the same input, hurting voice consistency. 0.3
        // tightens the distribution while leaving enough headroom that
        // responses don't read as canned.
        temperature: 0.3,
      },
      SAFE_TEMPLATE,
    );
  } catch (err) {
    if (isFailClosedLlmError(err)) {
      // R-04 cousin (Batch B.1) — dispatch the user-facing fallback before
      // finalize. Pre-fix the orchestrator returned `responseText: ''` and
      // the user received nothing on a primary+fallback LLM failure.
      const body = fallbackDegraded();
      await sendBody(deps, inbound, body, 'llm-call-failure');
      return finalize(deps, inbound, {
        endEvent: 'E11_ServiceUnavailable',
        responseText: body,
        practiceTag: tags.practiceTag,
        levelTag: tags.levelTag,
        latencyMs: Date.now() - t0,
        reason:
          err instanceof LlmServiceUnavailableError
            ? 'primary LLM 5xx + fallback failed'
            : 'primary LLM auth/internal failure',
        sessionId: session.sessionId,
        turnId: null,
      });
    }
    if (err instanceof LlmContentFilterError) {
      // chat() should have already rendered SAFE_TEMPLATE for us; re-raising
      // here means something else went wrong.
      reportP1(
        'chat() raised content-filter past safe-template fallback',
        {
          source: 'Process_2.Step_9.PrimaryLLM',
          extra: { userId: inbound.userId },
        },
        err,
      );
    }
    throw err;
  }

  // ---- Step 10: quality check ----------------------------------------
  const libs = await getActiveLibraryVersions(deps.db);
  const qc = await runQualityCheck(
    {
      config: deps.config,
      libraries: libs,
      originalSystemPrompt: promptBundle.assembledPrompt,
    },
    {
      candidateResponseText: chatResp.text,
      userMessage: inbound.body,
      responseMode: 'FullCoachingResponse',
      intent,
      predictedPracticeTag: tags.practiceTag,
      predictedLevelTag: tags.levelTag,
      userId: inbound.userId,
      sessionId: session.sessionId,
    },
  );

  if (qc.endEvent === 'E4_CrisisEscalation') {
    return await handleCrisis(
      deps,
      inbound,
      { status: 'crisis', reason: 'qc-second-line', intent },
      t0,
      session.sessionId,
    );
  }
  if (qc.endEvent === 'E5_SafetyHardFailure') {
    return finalize(deps, inbound, {
      endEvent: 'E11_ServiceUnavailable',
      responseText: '',
      practiceTag: tags.practiceTag,
      levelTag: tags.levelTag,
      latencyMs: Date.now() - t0,
      reason: 'qc safety hard fail',
      sessionId: session.sessionId,
      turnId: null,
    });
  }

  const responseText = qc.responseText;
  const isDegraded =
    qc.endEvent === 'E3_MaxRetriesExceeded' || qc.endEvent === 'E6_ServiceUnavailable';

  // ---- Step 11: delivery ---------------------------------------------
  const delivery = await sendBody(deps, inbound, responseText, 'coaching-response');
  if (delivery.failed) {
    return finalize(deps, inbound, {
      endEvent: 'E11_ServiceUnavailable',
      responseText,
      practiceTag: tags.practiceTag,
      levelTag: tags.levelTag,
      latencyMs: Date.now() - t0,
      reason: `delivery failed: ${delivery.reason}`,
      sessionId: session.sessionId,
      turnId: null,
    });
  }

  // ---- Step 12: post-turn parallel persistence (fail-open) -----------
  const turnLatency = Date.now() - t0;
  const postTurn = await persistPostTurn(
    { config: deps.config, db: deps.db },
    {
      userId: inbound.userId,
      sessionId: session.sessionId,
      userMessage: inbound.body,
      responseText,
      intent,
      practiceTag: tags.practiceTag,
      levelTag: tags.levelTag,
      secondaryPracticeTag: tags.secondaryPracticeTag,
      secondaryLevelTag: tags.secondaryLevelTag,
      taggerConfidence: tags.confidence,
      responseMode: 'FullCoachingResponse',
      modelUsed: chatResp.modelUsed,
      fallbackPath: chatResp.fallbackPath,
      qaOutcome: qc.endEvent,
      retryCount: qc.retryCount,
      latencyMs: turnLatency,
      degradationFlags: {
        memoryTruncated: promptBundle.degradationFlags.memoryTruncated,
        sessionTruncated: promptBundle.degradationFlags.sessionTruncated,
        culturalFramingDropped: promptBundle.degradationFlags.culturalFramingDropped,
        fallbackModelUsed: chatResp.fallbackPath !== 'none',
        contextFetchPartial: ctx.partialFailure,
      },
      libraryVersions: promptBundle.libraryVersions,
      determinismHash: promptBundle.determinismHash,
      deliveryReceipt: {
        ...(delivery.waMessageId !== undefined ? { waMessageId: delivery.waMessageId } : {}),
      },
      terminalEvent: 'pending',
    },
  );

  // ---- Step 13: continuation decision --------------------------------
  const continuation = decideContinuation(inbound.body);
  const endEvent: CoachingEndEvent = isDegraded
    ? 'E3_DegradedQuality'
    : continuation === 'close'
      ? 'E2_TurnCompletedSessionClosed'
      : 'E1_TurnCompleted';

  // ---- Trace emit + return -------------------------------------------
  emitTurnTrace(deps.traceEmitter, inbound.traceId, {
    userIdHash,
    sessionId: session.sessionId,
    turnId: postTurn.turnId ?? 'no-turn-row',
    terminalEvent: endEvent,
    modelUsed: chatResp.modelUsed,
    fallbackPath: chatResp.fallbackPath,
    latencyMs: turnLatency,
    qaOutcome:
      qc.endEvent === 'E1_ApprovedFirstAttempt'
        ? 'approved-first'
        : qc.endEvent === 'E2_ApprovedRegenerated'
          ? 'approved-regenerated'
          : qc.endEvent === 'E6_ServiceUnavailable'
            ? 'service-unavailable'
            : 'skipped',
    degradationFlags: {
      memoryTruncated: promptBundle.degradationFlags.memoryTruncated,
      sessionTruncated: promptBundle.degradationFlags.sessionTruncated,
      culturalFramingDropped: promptBundle.degradationFlags.culturalFramingDropped,
      fallbackModelUsed: chatResp.fallbackPath !== 'none',
      contextFetchPartial: ctx.partialFailure,
    },
    libraryVersions: promptBundle.libraryVersions,
    determinismHash: promptBundle.determinismHash,
    retryCount: qc.retryCount,
  });

  return {
    endEvent,
    responseText,
    ...(delivery.waMessageId !== undefined ? { waMessageId: delivery.waMessageId } : {}),
    practiceTag: tags.practiceTag,
    levelTag: tags.levelTag,
    latencyMs: turnLatency,
    sessionId: session.sessionId,
    turnId: postTurn.turnId,
    traceId: inbound.traceId,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MinimalFinalize {
  endEvent: CoachingEndEvent;
  responseText: string;
  practiceTag: PracticeTag | null;
  levelTag: LevelTag | null;
  latencyMs: number;
  reason: string;
  sessionId: string;
  /** Phase 12 R20 — short-circuit paths now persist a turn row, so this can be a TurnId. */
  turnId: TurnId | null;
  waMessageId?: string;
}

function finalize(
  deps: CoachingDeps,
  inbound: CoachingInbound,
  m: MinimalFinalize,
): CoachingTurnResult {
  // Trace emit for the lighter-path terminations too.
  emitTurnTrace(deps.traceEmitter, inbound.traceId, {
    userIdHash: hashPhone(inbound.phoneE164),
    sessionId: m.sessionId,
    turnId: 'no-turn-row',
    terminalEvent: m.endEvent,
    modelUsed: 'none',
    fallbackPath: 'none',
    latencyMs: m.latencyMs,
    qaOutcome: 'skipped',
    degradationFlags: {
      memoryTruncated: false,
      sessionTruncated: false,
      culturalFramingDropped: false,
      fallbackModelUsed: false,
      contextFetchPartial: false,
    },
    libraryVersions: {
      promptTemplates: { version: 'n/a', hash: 'n/a' },
      voiceRules: { version: 'n/a', hash: 'n/a' },
      culturalFraming: { version: 'n/a', hash: 'n/a' },
      resolvedAt: new Date(),
    },
    determinismHash: null,
    retryCount: 0,
  });

  return {
    endEvent: m.endEvent,
    responseText: m.responseText,
    ...(m.waMessageId !== undefined ? { waMessageId: m.waMessageId } : {}),
    practiceTag: m.practiceTag,
    levelTag: m.levelTag,
    latencyMs: m.latencyMs,
    sessionId: m.sessionId as never,
    turnId: m.turnId,
    traceId: inbound.traceId,
    reason: m.reason,
  };
}

async function handleCrisis(
  deps: CoachingDeps,
  inbound: CoachingInbound,
  triageResult: TriageResult,
  t0: number,
  sessionId?: string,
): Promise<CoachingTurnResult> {
  const trigger: 'process_2_step_1' | 'process_10_check_8' =
    triageResult.reason === 'qc-second-line' ? 'process_10_check_8' : 'process_2_step_1';
  await crisisHandoff(
    {
      config: deps.config,
      db: deps.db,
      redis: deps.redis,
      rateLimiters: deps.rateLimiters,
    },
    {
      triggerSource: trigger,
      phoneE164: inbound.phoneE164,
      userId: inbound.userId,
      ...(sessionId !== undefined ? { sessionId: sessionId as never } : {}),
    },
  );
  return finalize(deps, inbound, {
    endEvent: 'E7_Crisis',
    responseText: '',
    practiceTag: null,
    levelTag: null,
    latencyMs: Date.now() - t0,
    reason: triageResult.reason,
    sessionId: sessionId ?? 'pending',
    turnId: null,
  });
}

async function runTemplatedResponse(
  deps: CoachingDeps,
  inbound: CoachingInbound,
  sessionId: string,
  body: string,
  callerSubId: string,
  endEvent: CoachingEndEvent,
  t0: number,
  intent: string = 'Coaching',
): Promise<CoachingTurnResult> {
  const delivery = await sendBody(deps, inbound, body, callerSubId);
  const latencyMs = Date.now() - t0;

  // Phase 12 R20+R21 — persist a lightweight turn row + memory entry so the
  // bot remembers "user said hi yesterday" and sponsor portal aggregations
  // see all activity. Fail-open: errors are reported but don't block.
  // Crisis (E7) and silent-drop (E12) skip this — E7 has its own
  // crisis_events row; E12 has no response to persist.
  const persisted = await persistShortCircuitTurn(
    { config: deps.config, db: deps.db },
    {
      userId: inbound.userId,
      sessionId: sessionId as never,
      userMessage: inbound.body,
      responseText: body,
      callerSubId,
      intent,
      terminalEvent: endEvent,
      latencyMs,
      deliveryReceipt: {
        ...(delivery.waMessageId !== undefined ? { waMessageId: delivery.waMessageId } : {}),
      },
    },
  );

  return finalize(deps, inbound, {
    endEvent,
    responseText: body,
    practiceTag: null,
    levelTag: null,
    latencyMs,
    reason: `templated ${callerSubId}`,
    sessionId,
    turnId: persisted.turnId,
    ...(delivery.waMessageId !== undefined ? { waMessageId: delivery.waMessageId } : {}),
  });
}

async function sendBody(
  deps: CoachingDeps,
  inbound: CoachingInbound,
  body: string,
  callerSubId: string,
): Promise<{ failed: boolean; waMessageId?: string; reason?: string }> {
  const correlationId = asCorrelationId(
    `coach-${inbound.userId.slice(0, 8)}-${callerSubId}-${randomUUID().slice(0, 6)}`,
  );
  const r = await sendOutbound(
    {
      config: deps.config,
      db: deps.db,
      redis: deps.redis,
      rateLimiters: deps.rateLimiters,
      ownerId: 'coaching',
    },
    {
      correlationId,
      callerProcessId: `coaching:${callerSubId}`,
      phoneE164: inbound.phoneE164,
      userId: inbound.userId,
      messageType: 'FreeForm',
      priority: 'High',
      body,
    },
  );
  if (r.endEvent === 'E1_MessageDispatched' || r.endEvent === 'E2_MessageDispatchedAfterRetry') {
    return {
      failed: false,
      ...(r.waMessageId !== undefined ? { waMessageId: r.waMessageId } : {}),
    };
  }
  // Duplicate is ok (already-sent); same waMessageId is returned.
  if (r.endEvent === 'E5_DuplicateRequest') {
    return {
      failed: false,
      ...(r.waMessageId !== undefined ? { waMessageId: r.waMessageId } : {}),
    };
  }
  return { failed: true, reason: `${r.endEvent}: ${r.reason ?? 'unknown'}` };
}

export const _internal = {
  GREETING_RESPONSE,
  AFFIRMATION_RESPONSE,
  META_TEMPLATE,
  PROFILE_ACK_TEMPLATE,
  MEDIA_REJECT_TEMPLATE,
  SAFE_TEMPLATE,
  REJECT_TEMPLATE,
};
