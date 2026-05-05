import { createHash } from 'node:crypto';
import { and, desc, eq, gte } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { asDate } from '../shared/db/dates.js';
import { whatsappMessages } from '../shared/db/schema/whatsapp-messages.js';
import { PRACTICE_TAGS, type PracticeTag, type UserId } from '../shared/types/index.js';
import type { DailyPrompt, DailyPromptsPayload } from '../libraries/types.js';

/**
 * Phase 8A — daily-prompt selection.
 *
 * Three rules, applied in order:
 *   1. Practice rotation — pick the practice the user has seen least recently.
 *      (12 practices, 24 prompts; 2 per practice). When two practices are
 *      tied for "least recently seen", break the tie by deterministic hash
 *      so re-running on the same day picks the same one.
 *   2. History dedup — within the chosen practice's prompts, exclude any
 *      prompt-id already sent to the user in the last `dedupDays` days.
 *      (Default 30 days. With 2 prompts per practice and ~12-day rotation
 *      cadence, 30 days is enough that we will alternate.)
 *   3. Deterministic pick — hash(userId + dateKey) modulo the surviving
 *      pool. Same user, same day → same prompt, even across re-runs of
 *      the cron.
 *
 * Returns null when (a) the active payload has no prompts, or (b) every
 * prompt the user could see has been sent in the dedup window. Case (b)
 * should be effectively impossible for a 30-day window across 24 prompts;
 * we treat it as a no-op skip with a P2 log left to the dispatcher.
 */
export interface SelectionInput {
  userId: UserId;
  /** Today in the user's local timezone, formatted YYYY-MM-DD. */
  dateKey: string;
  payload: DailyPromptsPayload;
}

export interface SelectionContext {
  /** Most recent N days' worth of (practice, promptId) tuples for the user, newest first. */
  recentHistory: { practice: PracticeTag; promptId: string; sentAt: Date }[];
}

export interface SelectionResult {
  prompt: DailyPrompt;
  /** The date key consumed; echoed for trace + idempotency. */
  dateKey: string;
  /** Why this practice + prompt was chosen — used for trace. */
  reason: {
    practiceLastSeenAt: string | null;
    poolSize: number;
    excludedFromDedup: number;
  };
}

const HISTORY_LOOKBACK_DAYS = 30;

/**
 * Pure selector — testable without a DB. Provide the payload + recent
 * history; get back the selection. Use `loadRecentHistory` below to fetch
 * the history when running in production.
 */
export function selectDailyPrompt(
  input: SelectionInput,
  ctx: SelectionContext,
): SelectionResult | null {
  const { payload, userId, dateKey } = input;
  if (payload.prompts.length === 0) {
    return null;
  }

  const lastSeenByPractice = new Map<PracticeTag, Date>();
  for (const h of ctx.recentHistory) {
    if (!lastSeenByPractice.has(h.practice)) {
      lastSeenByPractice.set(h.practice, h.sentAt);
    }
  }

  // Build the practices that actually appear in the active payload —
  // a v1 payload may not have all 12.
  const practicesInPayload = new Set<PracticeTag>();
  for (const p of payload.prompts) {
    practicesInPayload.add(p.practice);
  }
  const candidatePractices = PRACTICE_TAGS.filter((p) => practicesInPayload.has(p));
  if (candidatePractices.length === 0) {
    return null;
  }

  // Rule 1: rotation — pick the practice with the oldest lastSeen, with
  // unseen practices winning over any seen practice.
  const ranked = candidatePractices.slice().sort((a, b) => {
    const aSeen = lastSeenByPractice.get(a)?.getTime();
    const bSeen = lastSeenByPractice.get(b)?.getTime();
    if (aSeen === undefined && bSeen === undefined) {
      // Both unseen — defer to deterministic hash tiebreaker.
      return tiebreaker(userId, dateKey, a) - tiebreaker(userId, dateKey, b);
    }
    if (aSeen === undefined) {
      return -1;
    }
    if (bSeen === undefined) {
      return 1;
    }
    if (aSeen !== bSeen) {
      return aSeen - bSeen;
    }
    return tiebreaker(userId, dateKey, a) - tiebreaker(userId, dateKey, b);
  });

  // Try each practice in rotation order until we find one with an
  // un-deduplicated prompt. The dedup window is 30 days.
  const recentlySentIds = new Set(ctx.recentHistory.map((h) => h.promptId));

  for (const practice of ranked) {
    const pool = payload.prompts.filter((p) => p.practice === practice);
    const surviving = pool.filter((p) => !recentlySentIds.has(p.id));
    if (surviving.length === 0) {
      continue;
    }
    const idx = stableHashIndex(`${userId}|${dateKey}`, surviving.length);
    const prompt = surviving[idx]!;
    const lastSeen = lastSeenByPractice.get(practice);
    return {
      prompt,
      dateKey,
      reason: {
        practiceLastSeenAt: lastSeen !== undefined ? lastSeen.toISOString() : null,
        poolSize: pool.length,
        excludedFromDedup: pool.length - surviving.length,
      },
    };
  }

  return null;
}

/**
 * Tiebreaker — deterministic per (userId, dateKey, practice). Used when
 * two practices have identical lastSeen times so we still pick consistently
 * across re-runs.
 */
function tiebreaker(userId: UserId, dateKey: string, practice: PracticeTag): number {
  const h = createHash('sha256').update(`${userId}|${dateKey}|${practice}`).digest();
  // First 4 bytes as unsigned int. Positive int range is plenty.
  return h.readUInt32BE(0);
}

function stableHashIndex(key: string, modulo: number): number {
  if (modulo <= 1) {
    return 0;
  }
  const h = createHash('sha256').update(key).digest();
  return h.readUInt32BE(0) % modulo;
}

/**
 * Production-side helper: fetch the user's recent daily-prompt sends
 * from `whatsapp_messages`. We rely on `caller_process_id` matching the
 * pattern `daily-prompt:YYYY-MM-DD` (set by the dispatcher) and recover
 * the prompt-id from `metadata.promptId`.
 *
 * Returns most-recent-first.
 */
export async function loadRecentHistory(
  db: Database,
  userId: UserId,
  now: Date = new Date(),
): Promise<SelectionContext['recentHistory']> {
  const cutoff = new Date(now.getTime() - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      callerProcessId: whatsappMessages.callerProcessId,
      metadata: whatsappMessages.metadata,
      createdAt: whatsappMessages.createdAt,
    })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.userId, userId as unknown as string),
        eq(whatsappMessages.direction, 'outbound'),
        gte(whatsappMessages.createdAt, cutoff),
      ),
    )
    .orderBy(desc(whatsappMessages.createdAt));

  const out: SelectionContext['recentHistory'] = [];
  for (const r of rows) {
    if (!r.callerProcessId.startsWith('daily-prompt:')) {
      continue;
    }
    const meta = r.metadata as { promptId?: unknown; practice?: unknown } | null;
    const promptId = typeof meta?.promptId === 'string' ? meta.promptId : null;
    const practice = typeof meta?.practice === 'string' ? meta.practice : null;
    if (promptId === null || practice === null) {
      continue;
    }
    if (!(PRACTICE_TAGS as readonly string[]).includes(practice)) {
      continue;
    }
    out.push({
      practice: practice as PracticeTag,
      promptId,
      // postgres-js returns timestamp columns as ISO strings — coerce to Date.
      sentAt: asDate(r.createdAt),
    });
  }
  return out;
}

/** Format a Date in YYYY-MM-DD using the given IANA zone. */
export function formatDateKey(date: Date, timezone: string): string {
  // en-CA returns YYYY-MM-DD; widely supported.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}
