import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { decryptPlaintext } from '../shared/db/encryption.js';
import { users } from '../shared/db/schema/users.js';
import { whatsappMessages } from '../shared/db/schema/whatsapp-messages.js';
import { reportP1, reportP2 } from '../incident-handling/index.js';
import { getActiveDailyPrompts } from '../libraries/index.js';
import type { DailyPromptsPayload } from '../libraries/types.js';
import type { RedisBundle } from '../shared/redis/client.js';
import type { RateLimiters } from '../shared/redis/rate-limit.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { asCorrelationId, asPhoneE164, asUserId, type UserId } from '../shared/types/index.js';
import { sendOutbound } from '../whatsapp-delivery/orchestrator.js';
import { checkWindowByUserId } from '../whatsapp-delivery/window.js';
import { isOptedIn } from './opt-in.js';
import { formatDateKey, loadRecentHistory, selectDailyPrompt } from './selection.js';

/**
 * Phase 8A — daily-prompt cron dispatcher.
 *
 * Selects + delivers one prompt per opted-in user per local-day. Idempotency
 * is keyed on caller_process_id `daily-prompt:{YYYY-MM-DD}` (in the user's
 * local zone), so:
 *   - re-running the cron at any time on the same day is a no-op for users
 *     who have already received that day's prompt;
 *   - the deterministic selector returns the SAME prompt on a re-run
 *     (preserves audit consistency).
 *
 * Strict 24h-window discipline (Process #11 §4): if the window is closed,
 * we skip with a P2 incident — there is no approved daily-prompt template
 * yet. Phase 2 work to register a template with Meta is tracked separately.
 *
 * Dispatcher does NOT:
 *   - bypass suppression / opt-out (Process #11 enforces);
 *   - send to users who have not finished onboarding (status != 'onboarded');
 *   - retry on failure beyond what Process #11 already does internally.
 */
interface DispatcherDeps {
  config: AppConfig;
  db: Database;
  redis: RedisBundle;
  rateLimiters: RateLimiters;
}

export interface DailyPromptRunResult {
  considered: number;
  dispatched: number;
  alreadySentToday: number;
  skippedOptedOut: number;
  skippedWindowClosed: number;
  skippedNoPrompt: number;
  skippedDispatchError: number;
}

export async function dispatchDailyPrompts(
  deps: DispatcherDeps,
  now: Date = new Date(),
): Promise<DailyPromptRunResult> {
  const result: DailyPromptRunResult = {
    considered: 0,
    dispatched: 0,
    alreadySentToday: 0,
    skippedOptedOut: 0,
    skippedWindowClosed: 0,
    skippedNoPrompt: 0,
    skippedDispatchError: 0,
  };

  let payload: DailyPromptsPayload;
  try {
    const lib = await getActiveDailyPrompts(deps.db);
    payload = lib.payload;
  } catch (err) {
    reportP1('daily prompt library unavailable; aborting cron run', {
      source: 'Phase8A.DailyPromptCron',
      extra: { error: err instanceof Error ? err.message : String(err) },
    });
    return result;
  }

  const candidates = await deps.db
    .select({
      id: users.id,
      phoneEncrypted: users.phoneEncrypted,
      timezone: users.timezone,
      profileFlags: users.profileFlags,
      status: users.status,
    })
    .from(users)
    .where(eq(users.status, 'onboarded'));

  for (const u of candidates) {
    result.considered += 1;
    const userId = asUserId(u.id);
    const tz = u.timezone ?? 'Africa/Mogadishu';
    const dateKey = formatDateKey(now, tz);

    if (!isOptedIn(u.profileFlags)) {
      result.skippedOptedOut += 1;
      continue;
    }

    const callerProcessId = `daily-prompt:${dateKey}`;
    if (await hasPriorDailyPrompt(deps.db, u.id, callerProcessId)) {
      result.alreadySentToday += 1;
      continue;
    }

    // Window check: daily prompt MVP is FreeForm-only; closed window → skip.
    const window = await checkWindowByUserId(deps.db, u.id, now);
    if (window === 'closed') {
      result.skippedWindowClosed += 1;
      reportP2('daily prompt skipped — 24h window closed (template not yet approved)', {
        source: 'Phase8A.DailyPromptCron',
        tags: { reason: 'window_closed' },
        extra: { userId: u.id, dateKey },
      });
      continue;
    }

    const recentHistory = await loadRecentHistory(deps.db, userId, now);
    const selection = selectDailyPrompt({ userId, dateKey, payload }, { recentHistory });
    if (selection === null) {
      result.skippedNoPrompt += 1;
      reportP2('daily prompt selection returned null', {
        source: 'Phase8A.DailyPromptCron',
        tags: { reason: 'no_eligible_prompt' },
        extra: { userId: u.id, dateKey },
      });
      continue;
    }

    const phoneE164 = decodePhone(deps.config, u.phoneEncrypted);
    if (phoneE164 === null) {
      result.skippedDispatchError += 1;
      reportP2('cannot decode phone for daily prompt', {
        source: 'Phase8A.DailyPromptCron',
        extra: { userId: u.id },
      });
      continue;
    }

    const correlationId = asCorrelationId(
      `daily-${dateKey}-${u.id.slice(0, 8)}-${randomUUID().slice(0, 6)}`,
    );

    const send = await sendOutbound(
      {
        config: deps.config,
        db: deps.db,
        redis: deps.redis,
        rateLimiters: deps.rateLimiters,
        ownerId: 'daily-prompt-cron',
      },
      {
        correlationId,
        callerProcessId,
        phoneE164: asPhoneE164(phoneE164),
        userId: u.id as UserId,
        messageType: 'FreeForm',
        priority: 'Normal',
        body: selection.prompt.body,
      },
    );

    if (
      send.endEvent === 'E1_MessageDispatched' ||
      send.endEvent === 'E2_MessageDispatchedAfterRetry'
    ) {
      result.dispatched += 1;
      // Augment the metadata on the just-written whatsapp_messages row so the
      // history loader can recover (practice, promptId) later. Process #11
      // already wrote a metadata blob for trace; we extend it here, not
      // overwrite, so the dispatch trace survives.
      await augmentMetadata(deps.db, correlationId, {
        promptId: selection.prompt.id,
        practice: selection.prompt.practice,
        kind: selection.prompt.kind,
      });
    } else if (send.endEvent === 'E7_SuppressedRecipient') {
      result.skippedOptedOut += 1;
    } else {
      result.skippedDispatchError += 1;
      reportP1('daily prompt dispatch failed', {
        source: 'Phase8A.DailyPromptCron',
        tags: { endEvent: send.endEvent },
        extra: {
          userId: u.id,
          promptId: selection.prompt.id,
          reason: send.reason ?? 'unknown',
        },
      });
    }
  }

  return result;
}

async function hasPriorDailyPrompt(
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
    .limit(1);
  return rows.length > 0;
}

async function augmentMetadata(
  db: Database,
  correlationId: string,
  extras: { promptId: string; practice: string; kind: string },
): Promise<void> {
  try {
    const rows = await db
      .select({ metadata: whatsappMessages.metadata })
      .from(whatsappMessages)
      .where(eq(whatsappMessages.correlationId, correlationId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      return;
    }
    const merged = { ...((row.metadata as object) ?? {}), ...extras };
    await db
      .update(whatsappMessages)
      .set({ metadata: merged })
      .where(eq(whatsappMessages.correlationId, correlationId));
  } catch (err) {
    // Fail-open — metadata augmentation is non-critical; the message went out.
    reportP2('daily prompt metadata augment failed', {
      source: 'Phase8A.DailyPromptCron',
      extra: { correlationId, error: err instanceof Error ? err.message : String(err) },
    });
  }
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
