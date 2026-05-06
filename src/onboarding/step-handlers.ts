import { eq } from 'drizzle-orm';
import { type GoalOption, type LastCompletedStep, type RoleOption } from './types.js';
import {
  CONSENT_DECLINED_MESSAGE,
  CONSENT_PROMPT,
  GOAL_PROMPT,
  GOAL_RETRY_PROMPT,
  LOCATION_PROMPT,
  ROLE_PROMPT,
  ROLE_RETRY_PROMPT,
} from './messages.js';
import { goalsToPractices, parseConsent, parseGoals, parseLocation, parseRole } from './parsers.js';
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
  // Ambiguous — re-ask.
  return { outboundBody: CONSENT_PROMPT, newStep: 2, defaultsApplied: false };
}

// --- Step 4: Goal -----------------------------------------------------------

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
        outboundBody: ROLE_PROMPT,
        newStep: 4,
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
    outboundBody: ROLE_PROMPT,
    newStep: 4,
    defaultsApplied: false,
    dataUpdate: {
      goals: parsed.goals,
      mappedPractices: goalsToPractices(parsed.goals),
    },
  };
}

// --- Step 5: Role -----------------------------------------------------------

export function handleRoleReply(text: string, attemptNumber: number): StepResult {
  const role = parseRole(text);
  if (role === 'invalid') {
    if (attemptNumber >= PARSE_RETRY_LIMIT) {
      const fallback: RoleOption = 'Professional';
      return {
        outboundBody: LOCATION_PROMPT,
        newStep: 5,
        defaultsApplied: true,
        dataUpdate: { role: fallback, needsProfileReview: true },
      };
    }
    return { outboundBody: ROLE_RETRY_PROMPT, newStep: 4, defaultsApplied: false };
  }
  return {
    outboundBody: LOCATION_PROMPT,
    newStep: 5,
    defaultsApplied: false,
    dataUpdate: { role },
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
