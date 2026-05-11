import { eq } from 'drizzle-orm';
import { type ExperienceBand, type GoalOption, type LastCompletedStep } from './types.js';
import {
  CONSENT_DECLINED_MESSAGE,
  CONSENT_PROMPT,
  EXPERIENCE_PROMPT,
  EXPERIENCE_RETRY_PROMPT,
  FIRST_COACHING_PROMPT,
  formatPracticeAcknowledgment,
  GOAL_PROMPT,
  GOAL_RETRY_PROMPT,
  LOCATION_PROMPT,
} from './messages.js';
import {
  goalsToPractices,
  parseConsent,
  parseExperienceBand,
  parseGoals,
  parseLocation,
} from './parsers.js';
import { detectPreConsentFaq } from './pre-consent-faq.js';
import type { Database } from '../shared/db/client.js';
import { users } from '../shared/db/schema/users.js';
import type { UserId } from '../shared/types/index.js';

/**
 * Each step handler returns the same envelope: an outbound prompt to send
 * (or null when the orchestrator is going to send something else, e.g. the
 * confirmation flow which dispatches its own messages), the new step
 * number, and any user-record updates to persist.
 */
export interface StepResult {
  outboundBody: string | null;
  newStep: LastCompletedStep;
  /** True when this step's parser exhausted retries and applied defaults. */
  defaultsApplied: boolean;
  /** Profile fields to update on the user record. */
  dataUpdate?: Partial<{
    role: string;
    experienceBand: ExperienceBand;
    location: string;
    timezone: string;
    isDiaspora: boolean;
    goals: GoalOption[];
    mappedPractices: string[];
    needsProfileReview: boolean;
  }>;
  /** When set, the orchestrator should terminate with this end event. */
  terminalEvent?: 'E3_ConsentDeclined';
}

const PARSE_RETRY_LIMIT = 3;

// --- Step 3: Consent ---------------------------------------------------------

export function handleConsentReply(text: string): StepResult {
  const verdict = parseConsent(text);
  if (verdict === 'yes') {
    return { outboundBody: GOAL_PROMPT, newStep: 3, defaultsApplied: false };
  }
  if (verdict === 'no') {
    return {
      outboundBody: CONSENT_DECLINED_MESSAGE,
      newStep: 0, // declined — user stays at step 0 (provisional → consent_declined)
      defaultsApplied: false,
      terminalEvent: 'E3_ConsentDeclined',
    };
  }
  // Ambiguous — try the pre-consent FAQ handler before falling through to a
  // generic re-ask. Khadija field test 2026-05-11: users asked sensible
  // pre-consent questions ("can I get a mentor?", "what are daily prompts?")
  // and the bot just re-sent the consent prompt verbatim. FAQ-detected
  // inbounds now get a one-line answer + a nudge back to "yes / sow."
  const faq = detectPreConsentFaq(text);
  if (faq !== null) {
    return { outboundBody: faq.reply, newStep: 2, defaultsApplied: false };
  }
  // Truly unrecognized — fall back to existing re-ask behavior.
  return { outboundBody: CONSENT_PROMPT, newStep: 2, defaultsApplied: false };
}

// --- Step 4: Goal → Onboarded ----------------------------------------------
//
// Khadija UX Reframe (2026-05-11): collapse the rest of onboarding. After
// practice pick, deliver the inline-gloss acknowledgment + first-coaching
// prompt in a SINGLE message, mark the user onboarded, advance to step 7.
// Experience-band and location are no longer asked during onboarding — they
// default cleanly (band='absent' → 5-to-10y calibration default; timezone
// → Africa/Mogadishu default). Time-to-value drops from 6–7 turns to 3.

export function handleGoalReply(
  text: string,
  attemptNumber: number, // 1-based; orchestrator tracks via profile_flags
): StepResult {
  const parsed = parseGoals(text);
  if (parsed === 'invalid') {
    if (attemptNumber >= PARSE_RETRY_LIMIT) {
      // R14 default: integrity (foundational practice). Was 'Leadership confidence'.
      const goals: GoalOption[] = ['integrity'];
      return {
        outboundBody: formatGoalAckPlusCoachingPrompt(goals),
        newStep: 7,
        defaultsApplied: true,
        dataUpdate: {
          goals,
          mappedPractices: goalsToPractices(goals),
          needsProfileReview: true,
        },
      };
    }
    return { outboundBody: GOAL_RETRY_PROMPT, newStep: 3, defaultsApplied: false };
  }
  return {
    outboundBody: formatGoalAckPlusCoachingPrompt(parsed.goals),
    newStep: 7,
    defaultsApplied: false,
    dataUpdate: {
      goals: parsed.goals,
      mappedPractices: goalsToPractices(parsed.goals),
    },
  };
}

function formatGoalAckPlusCoachingPrompt(practices: readonly string[]): string {
  return `${formatPracticeAcknowledgment([...practices])}\n\n${FIRST_COACHING_PROMPT}`;
}

// --- Step 5: Experience band ------------------------------------------------

// Customer-feedback PR4 — replaces the role-picker. Customer reported the
// 5-option role list ("everyone is a leader") didn't discriminate; years of
// leadership experience does. Default on retry-limit is '<5' (the most
// common cohort and the one most likely to want foundational coaching).
export function handleExperienceReply(text: string, attemptNumber: number): StepResult {
  const band = parseExperienceBand(text);
  if (band === 'invalid') {
    if (attemptNumber >= PARSE_RETRY_LIMIT) {
      const fallback: ExperienceBand = '<5';
      return {
        outboundBody: LOCATION_PROMPT,
        newStep: 5,
        defaultsApplied: true,
        dataUpdate: { experienceBand: fallback, needsProfileReview: true },
      };
    }
    return { outboundBody: EXPERIENCE_RETRY_PROMPT, newStep: 4, defaultsApplied: false };
  }
  return {
    outboundBody: LOCATION_PROMPT,
    newStep: 5,
    defaultsApplied: false,
    dataUpdate: { experienceBand: band },
  };
}

// --- Step 6: Location -------------------------------------------------------

export function handleLocationReply(text: string): StepResult {
  const parsed = parseLocation(text);
  if (parsed === 'skip') {
    return {
      outboundBody: null,
      newStep: 6,
      defaultsApplied: false,
      // Default timezone per build plan open question §5: East Africa Time.
      dataUpdate: { timezone: 'Africa/Mogadishu', isDiaspora: false },
    };
  }
  return {
    outboundBody: null,
    newStep: 6,
    defaultsApplied: false,
    dataUpdate: {
      location: parsed.literal,
      timezone: parsed.timezone,
      isDiaspora: parsed.isDiaspora,
    },
  };
}

/**
 * Apply the dataUpdate from a step handler to the users row. Idempotent —
 * Step 7 persistence is just `apply` on the final update plus a status flip
 * to 'onboarding_started' if the user is still 'provisional'.
 */
export async function applyDataUpdate(
  db: Database,
  userId: UserId,
  newStep: LastCompletedStep,
  dataUpdate: NonNullable<StepResult['dataUpdate']> | undefined,
): Promise<void> {
  const update: Record<string, unknown> = {
    lastCompletedStep: newStep,
  };

  // Promote 'provisional' → 'onboarding_started' on the first non-trivial step.
  if (newStep >= 2) {
    // Only update status if it's still provisional. Drizzle doesn't support
    // a CASE WHEN in update; we read current status first.
    const cur = await db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (cur[0]?.status === 'provisional') {
      update['status'] = 'onboarding_started';
    }
  }

  if (dataUpdate?.role !== undefined) {
    update['role'] = dataUpdate.role;
  }
  if (dataUpdate?.experienceBand !== undefined) {
    update['experienceBand'] = dataUpdate.experienceBand;
  }
  if (dataUpdate?.location !== undefined) {
    update['location'] = dataUpdate.location;
  }
  if (dataUpdate?.timezone !== undefined) {
    update['timezone'] = dataUpdate.timezone;
  }
  if (dataUpdate?.isDiaspora !== undefined) {
    update['isDiaspora'] = dataUpdate.isDiaspora;
  }
  if (dataUpdate?.goals !== undefined) {
    update['goals'] = dataUpdate.goals;
  }
  if (dataUpdate?.mappedPractices !== undefined) {
    update['mappedPractices'] = dataUpdate.mappedPractices;
  }
  if (dataUpdate?.needsProfileReview === true) {
    update['needsProfileReview'] = true;
  }

  await db.update(users).set(update).where(eq(users.id, userId));
}
