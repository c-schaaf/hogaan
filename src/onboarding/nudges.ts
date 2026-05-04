import { randomUUID } from 'node:crypto';
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { decryptPlaintext } from '../shared/db/encryption.js';
import { users } from '../shared/db/schema/users.js';
import { whatsappMessages } from '../shared/db/schema/whatsapp-messages.js';
import { reportP1, reportP2 } from '../incident-handling/index.js';
import type { RedisBundle } from '../shared/redis/client.js';
import type { RateLimiters } from '../shared/redis/rate-limit.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { asCorrelationId, asPhoneE164 } from '../shared/types/index.js';
import { sendOutbound } from '../whatsapp-delivery/orchestrator.js';
import { DORMANT_7D, NUDGE_4H, NUDGE_48H } from './messages.js';

/**
 * Process #1 §Boundary Timers — cron-driven dispatcher.
 *
 * Invoke periodically (Render cron, 5-minute cadence is reasonable). For each
 * user in `onboarding_started` status whose last-touched timestamp crosses
 * one of the thresholds, dispatch the corresponding nudge — at most once
 * per threshold per user.
 *
 *   - 4h non-interrupting:  NUDGE_4H
 *   - 48h non-interrupting: NUDGE_48H
 *   - 7d  interrupting:     DORMANT_7D + status flip to 'onboarding_dormant'
 *
 * Idempotency is enforced via the per-user nudge log in
 * `whatsapp_messages.caller_process_id` (e.g. 'onboarding-nudge:4h'); we
 * only dispatch a nudge if no prior outbound row carries the matching
 * caller_process_id for this user.
 */

interface NudgeDeps {
  config: AppConfig;
  db: Database;
  redis: RedisBundle;
  rateLimiters: RateLimiters;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const THRESHOLDS = [
  { id: '4h', minAgeMs: 4 * HOUR_MS, body: NUDGE_4H, interrupting: false },
  { id: '48h', minAgeMs: 48 * HOUR_MS, body: NUDGE_48H, interrupting: false },
  { id: '7d', minAgeMs: 7 * DAY_MS, body: DORMANT_7D, interrupting: true },
] as const;

export interface NudgeRunResult {
  dispatchedByThreshold: Record<string, number>;
  /** Users moved to 'onboarding_dormant' at the 7d threshold. */
  parkedDormant: number;
  /** Users skipped due to opt-out / blocked / already-onboarded etc. */
  skipped: number;
}

export async function dispatchOnboardingNudges(
  deps: NudgeDeps,
  now: Date = new Date(),
): Promise<NudgeRunResult> {
  const result: NudgeRunResult = {
    dispatchedByThreshold: { '4h': 0, '48h': 0, '7d': 0 },
    parkedDormant: 0,
    skipped: 0,
  };

  // Walk thresholds from oldest to newest so a user who's been idle for 8d
  // gets the 7d-dormant first and is skipped from the 4h/48h passes.
  for (const t of [...THRESHOLDS].reverse()) {
    const cutoff = new Date(now.getTime() - t.minAgeMs);
    const candidates = await deps.db
      .select({
        id: users.id,
        phoneEncrypted: users.phoneEncrypted,
        lastCompletedStep: users.lastCompletedStep,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(and(eq(users.status, 'onboarding_started'), lt(users.updatedAt, cutoff)));

    for (const u of candidates) {
      const callerProcessId = `onboarding-nudge:${t.id}`;
      const alreadySent = await hasPriorNudge(deps.db, u.id, callerProcessId);
      if (alreadySent) {
        continue;
      }

      const phoneE164 = decodePhone(deps.config, u.phoneEncrypted);
      if (phoneE164 === null) {
        result.skipped += 1;
        reportP2('cannot decode phone for nudge dispatch', {
          source: 'Process_1.NudgeCron',
          extra: { userId: u.id, threshold: t.id },
        });
        continue;
      }

      const correlationId = asCorrelationId(
        `nudge-${t.id}-${u.id.slice(0, 8)}-${randomUUID().slice(0, 6)}`,
      );
      const send = await sendOutbound(
        {
          config: deps.config,
          db: deps.db,
          redis: deps.redis,
          rateLimiters: deps.rateLimiters,
          ownerId: 'onboarding-nudge',
        },
        {
          correlationId,
          callerProcessId,
          phoneE164: asPhoneE164(phoneE164),
          userId: u.id as never,
          messageType: 'FreeForm',
          priority: 'Normal',
          body: t.body,
        },
      );
      if (
        send.endEvent === 'E1_MessageDispatched' ||
        send.endEvent === 'E2_MessageDispatchedAfterRetry'
      ) {
        result.dispatchedByThreshold[t.id] = (result.dispatchedByThreshold[t.id] ?? 0) + 1;
        if (t.interrupting) {
          // 7d: park dormant.
          await deps.db
            .update(users)
            .set({ status: 'onboarding_dormant' })
            .where(eq(users.id, u.id));
          result.parkedDormant += 1;
        }
      } else if (send.endEvent === 'E7_SuppressedRecipient') {
        // Honor opt-out — don't re-flag, don't retry.
        result.skipped += 1;
      } else {
        reportP1('onboarding nudge dispatch failed', {
          source: 'Process_1.NudgeCron',
          tags: { threshold: t.id, endEvent: send.endEvent },
          extra: { userId: u.id, reason: send.reason ?? 'unknown' },
        });
      }
    }
  }
  return result;
}

async function hasPriorNudge(
  db: Database,
  userId: string,
  callerProcessId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: whatsappMessages.id })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.userId, userId),
        eq(whatsappMessages.callerProcessId, callerProcessId),
        eq(whatsappMessages.direction, 'outbound'),
      ),
    )
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(1);
  return rows.length > 0;
}

function decodePhone(config: AppConfig, encrypted: string | null): string | null {
  if (encrypted === null) {
    return null;
  }
  try {
    return decryptPlaintext(config, encrypted);
  } catch {
    return null;
  }
}

/** Test seam — exposes the threshold table without re-deriving constants. */
export const _NUDGE_THRESHOLDS = THRESHOLDS;
