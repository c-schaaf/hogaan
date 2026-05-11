import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { users } from '../shared/db/schema/users.js';
import { reportP1 } from '../incident-handling/index.js';
import type { RedisBundle } from '../shared/redis/client.js';
import type { RateLimiters } from '../shared/redis/rate-limit.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { asCorrelationId, asPhoneE164, type UserId } from '../shared/types/index.js';
import { sendOutbound } from '../whatsapp-delivery/orchestrator.js';
import { tryRedeemCode } from './code-redemption.js';
import {
  CONSENT_PROMPT,
  FIRST_COACHING_PROMPT,
  OPT_OUT_CONFIRMATION,
  WELCOME_BACK_DUPLICATE,
  WELCOME_MESSAGE,
} from './messages.js';
import type { OnboardingEndEvent } from './end-events.js';
import { isOptOutMessage, recordOptOut } from './opt-out.js';
import {
  applyDataUpdate,
  handleConsentReply,
  handleGoalReply,
  type StepResult,
} from './step-handlers.js';
import type { LastCompletedStep, OnboardingInboundEvent, OnboardingResult } from './types.js';

interface OrchestratorDeps {
  config: AppConfig;
  db: Database;
  redis: RedisBundle;
  rateLimiters: RateLimiters;
}

const CALLER = 'onboarding';

/**
 * Process #1 entry. Receives an inbound user message, dispatches by
 * `last_completed_step`, returns the OnboardingResult naming the new state.
 *
 * The orchestrator is stateless across calls — all state lives on the
 * `users` row (`status`, `last_completed_step`, profile fields,
 * `profile_flags` for retry counters). Concurrency: identity resolution
 * (Process #12 §4) holds the advisory lock when this is invoked downstream
 * from the inbound webhook, so two messages for the same user serialize.
 *
 * Resume router (BPMN §Step 1): after the Khadija UX Reframe (2026-05-11)
 * the flow collapsed from 6 to 3 entry points. Steps 4, 5, 6 are deleted —
 * experience-band and location are no longer captured during onboarding
 * (they default cleanly). Any user mid-old-flow on deploy gets routed
 * through the stale-state catch-up branch.
 */
export async function handleOnboardingMessage(
  deps: OrchestratorDeps,
  event: OnboardingInboundEvent,
): Promise<OnboardingResult> {
  // ---- Pre-step: global opt-out
  if (isOptOutMessage(event.body)) {
    await recordOptOut(deps.db, deps.redis, event.userId, event.phoneHash);
    await dispatch(deps, event, OPT_OUT_CONFIRMATION, 'opt-out-confirm');
    return {
      endEvent: 'E5_OnboardingAbandoned',
      newLastCompletedStep: 0,
      needsProfileReview: false,
      reason: 'user opted out via STOP keyword',
    };
  }

  // ---- Read state
  const userRow = await deps.db
    .select({
      id: users.id,
      status: users.status,
      lastCompletedStep: users.lastCompletedStep,
      profileFlags: users.profileFlags,
      cohortId: users.cohortId,
    })
    .from(users)
    .where(eq(users.id, event.userId))
    .limit(1);

  const user = userRow[0];
  if (user === undefined) {
    throw new Error(`onboarding: user ${event.userId} not found`);
  }

  // ---- Already-onboarded short-circuit (Process #1 §Gateway User Status).
  if (user.status === 'onboarded') {
    await dispatch(deps, event, WELCOME_BACK_DUPLICATE, 'welcome-back-duplicate');
    return {
      endEvent: 'E8_DuplicateNumber',
      newLastCompletedStep: 7,
      needsProfileReview: false,
      reason: 'user already onboarded',
    };
  }

  // Already-opted-out: don't re-onboard. (Process #12 normally suppresses
  // before reaching here; this is defense-in-depth.)
  if (user.status === 'opted_out' || user.status === 'blocked') {
    return {
      endEvent: 'E5_OnboardingAbandoned',
      newLastCompletedStep: 0,
      needsProfileReview: false,
      reason: `user status=${user.status}`,
    };
  }

  if (user.status === 'consent_declined') {
    return {
      endEvent: 'E3_ConsentDeclined',
      newLastCompletedStep: 0,
      needsProfileReview: false,
      reason: 'user previously declined consent',
    };
  }

  // ---- Resume router: dispatch by lastCompletedStep
  const step = (user.lastCompletedStep ?? 0) as LastCompletedStep;
  const flags = (user.profileFlags as Record<string, unknown> | null) ?? {};
  const isResumed = step !== 0;

  switch (step) {
    case 0:
    case 2: {
      // Step 0 → send welcome (and try code redemption from the first message).
      // Step 2 → user has welcomed, awaiting consent reply.
      if (step === 0) {
        return await runStep00to02(deps, event, isResumed);
      }
      return await runStep03Consent(deps, event, isResumed);
    }
    case 3:
      // Step 3 → user has consented, awaiting practice pick. On success this
      // handler marks the user onboarded and dispatches the inline-gloss ack
      // + FIRST_COACHING_PROMPT in a single message (newStep=7).
      return await runStep04Goal(deps, event, isResumed, flags);
    case 4:
    case 5:
    case 6:
    case 7:
      // Stale-state catch-up: users who were mid-old-flow before the
      // Khadija UX Reframe (or who crashed mid-onboarding) get fast-tracked
      // to onboarded. They've already given consent + goals; experience and
      // location default cleanly. We just dispatch FIRST_COACHING_PROMPT and
      // mark them done. Their current inbound is dropped (the next one
      // routes to the coaching orchestrator).
      return await runStaleStateCatchUp(deps, event, isResumed);
  }
}

// ---------------------------------------------------------------------------
// Step handlers — each owns one transition and returns OnboardingResult.
// ---------------------------------------------------------------------------

async function runStep00to02(
  deps: OrchestratorDeps,
  event: OnboardingInboundEvent,
  _isResumed: boolean,
): Promise<OnboardingResult> {
  // Try to redeem an access code from the first message.
  const redeem = await tryRedeemCode(deps.db, event.userId, event.body);
  let cohortId: string | undefined;
  if (redeem.kind === 'redeemed') {
    cohortId = redeem.cohortId;
  } else if (redeem.kind === 'already_redeemed') {
    cohortId = redeem.existingCohortId;
  }

  // Send welcome + consent prompt back-to-back.
  await dispatch(deps, event, `${WELCOME_MESSAGE}\n\n${CONSENT_PROMPT}`, 'welcome+consent');
  await applyDataUpdate(deps.db, event.userId, 2, undefined);
  return {
    endEvent: 'IN_PROGRESS',
    newLastCompletedStep: 2,
    ...(cohortId !== undefined ? { cohortId: cohortId as never } : {}),
    needsProfileReview: false,
    reason: 'welcome + consent prompt sent',
  };
}

async function runStep03Consent(
  deps: OrchestratorDeps,
  event: OnboardingInboundEvent,
  _isResumed: boolean,
): Promise<OnboardingResult> {
  const r = handleConsentReply(event.body);
  if (r.terminalEvent === 'E3_ConsentDeclined') {
    await deps.db
      .update(users)
      .set({ status: 'consent_declined' })
      .where(eq(users.id, event.userId));
    if (r.outboundBody !== null) {
      await dispatch(deps, event, r.outboundBody, 'consent-declined');
    }
    return {
      endEvent: 'E3_ConsentDeclined',
      newLastCompletedStep: 0,
      needsProfileReview: false,
      reason: 'user replied no to consent',
    };
  }
  if (r.outboundBody !== null) {
    await dispatch(
      deps,
      event,
      r.outboundBody,
      `consent-${r.newStep === 3 ? 'accepted' : 'reasked'}`,
    );
  }
  await applyDataUpdate(deps.db, event.userId, r.newStep, r.dataUpdate);
  return {
    endEvent: 'IN_PROGRESS',
    newLastCompletedStep: r.newStep,
    needsProfileReview: false,
    reason: r.newStep === 3 ? 'consent accepted; goal prompt sent' : 'consent reasked',
  };
}

async function runStep04Goal(
  deps: OrchestratorDeps,
  event: OnboardingInboundEvent,
  isResumed: boolean,
  flags: Record<string, unknown>,
): Promise<OnboardingResult> {
  const goalAttempts = (flags['goalAttempts'] as number | undefined) ?? 0;
  const r = handleGoalReply(event.body, goalAttempts + 1);
  await persistAttempt(deps.db, event.userId, flags, 'goalAttempts', goalAttempts + 1, r);
  if (r.outboundBody !== null) {
    await dispatch(deps, event, r.outboundBody, 'goal-reply');
  }

  // Khadija UX Reframe: on success the goal handler returns newStep=7. That
  // means we've delivered the inline-gloss ack + FIRST_COACHING_PROMPT in one
  // message and the user is done with onboarding. Finalize state.
  if (r.newStep === 7) {
    await finalizeOnboarded(deps.db, event.userId);
    const needsReview = r.defaultsApplied;
    let endEvent: OnboardingEndEvent;
    if (needsReview) {
      endEvent = 'E7_ClarificationLoopExceeded';
    } else if (isResumed) {
      endEvent = 'E2_CompletedAfterResume';
    } else {
      endEvent = 'E1_CompletedFirstTry';
    }
    return {
      endEvent,
      newLastCompletedStep: 7,
      needsProfileReview: needsReview,
      reason: needsReview ? 'goal defaults applied; onboarded with review flag' : 'onboarded',
    };
  }

  // Retry path: handler returned newStep=3 (re-ask). Still in-progress.
  return {
    endEvent: 'IN_PROGRESS',
    newLastCompletedStep: r.newStep,
    needsProfileReview: false,
    reason: 'goal re-ask',
  };
}

/**
 * Stale-state catch-up for users with lastCompletedStep ∈ {4, 5, 6, 7} but
 * status != 'onboarded'. Pre-Khadija-UX-Reframe these meant "mid-old-flow"
 * or "crashed during confirmation." Either way, fast-track to onboarded:
 * they've given consent + goals, which is all we need. Their current
 * inbound is consumed by this turn; the next inbound routes to coaching.
 */
async function runStaleStateCatchUp(
  deps: OrchestratorDeps,
  event: OnboardingInboundEvent,
  isResumed: boolean,
): Promise<OnboardingResult> {
  await dispatch(deps, event, FIRST_COACHING_PROMPT, 'stale-state-catch-up');
  await finalizeOnboarded(deps.db, event.userId);
  return {
    endEvent: isResumed ? 'E2_CompletedAfterResume' : 'E1_CompletedFirstTry',
    newLastCompletedStep: 7,
    needsProfileReview: false,
    reason: 'stale onboarding state caught up; user marked onboarded',
  };
}

async function finalizeOnboarded(db: Database, userId: UserId): Promise<void> {
  await db
    .update(users)
    .set({
      status: 'onboarded',
      lastCompletedStep: 7,
      onboardingCompletedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function dispatch(
  deps: OrchestratorDeps,
  event: OnboardingInboundEvent,
  body: string,
  callerSubId: string,
): Promise<void> {
  const correlationId = asCorrelationId(
    `onb-${event.userId.slice(0, 8)}-${callerSubId}-${randomUUID().slice(0, 8)}`,
  );
  const result = await sendOutbound(
    {
      config: deps.config,
      db: deps.db,
      redis: deps.redis,
      rateLimiters: deps.rateLimiters,
      ownerId: CALLER,
    },
    {
      correlationId,
      callerProcessId: `${CALLER}:${callerSubId}`,
      phoneE164: asPhoneE164(event.phoneE164),
      userId: event.userId,
      messageType: 'FreeForm',
      priority: 'High',
      body,
    },
  );
  if (
    result.endEvent !== 'E1_MessageDispatched' &&
    result.endEvent !== 'E2_MessageDispatchedAfterRetry' &&
    result.endEvent !== 'E5_DuplicateRequest'
  ) {
    reportP1('onboarding outbound did not dispatch cleanly', {
      source: `Process_1.${callerSubId}`,
      tags: { endEvent: result.endEvent },
      extra: { reason: result.reason ?? 'unknown' },
    });
  }
}

async function persistAttempt(
  db: Database,
  userId: UserId,
  currentFlags: Record<string, unknown>,
  attemptKey: string,
  newAttempt: number,
  r: StepResult,
): Promise<void> {
  const newFlags: Record<string, unknown> = { ...currentFlags, [attemptKey]: newAttempt };
  if (r.defaultsApplied) {
    newFlags['needsProfileReview'] = true;
  }
  // Apply data update inline so the user record reflects the captured field.
  await applyDataUpdate(db, userId, r.newStep, r.dataUpdate);
  await db.update(users).set({ profileFlags: newFlags }).where(eq(users.id, userId));
}
