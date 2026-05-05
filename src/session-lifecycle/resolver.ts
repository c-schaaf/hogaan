import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { asDate } from '../shared/db/dates.js';
import { sessions } from '../shared/db/schema/sessions.js';
import { asSessionId } from '../shared/types/index.js';
import type { ResolveOptions, SessionResolution } from './types.js';

/**
 * Process #6 §session resolver — minimal MVP per Phase 4B plan:
 *   - 30-min idle → new session
 *   - >7d idle → still treated as "new"; the old session is archived
 *     (closed_at = last_turn_at) at the same time so we don't accumulate
 *     dangling open rows.
 *
 * Concurrency note: two near-simultaneous inbound messages for the same user
 * could race here and produce two new sessions. Rare for our scale, and
 * downstream merging is cheap. If it becomes a problem, wrap in the same
 * advisory-lock pattern as Process #12 §4.
 */

export const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 minutes
export const SESSION_ARCHIVE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function resolveSession(
  db: Database,
  opts: ResolveOptions,
): Promise<SessionResolution> {
  const now = opts.now ?? new Date();

  const existing = await db
    .select({
      id: sessions.id,
      lastTurnAt: sessions.lastTurnAt,
      turnCount: sessions.turnCount,
      metadata: sessions.metadata,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, opts.userId), isNull(sessions.closedAt)))
    .orderBy(desc(sessions.lastTurnAt))
    .limit(1);

  const recent = existing[0];
  if (recent !== undefined) {
    // postgres-js returns timestamps as ISO strings; coerce at the boundary.
    const lastTurnAt = asDate(recent.lastTurnAt);
    const ageMs = now.getTime() - lastTurnAt.getTime();
    if (ageMs <= SESSION_IDLE_MS) {
      return {
        sessionId: asSessionId(recent.id),
        isNew: false,
        turnCount: recent.turnCount,
        lastTurnAt,
        metadata: recent.metadata as Record<string, unknown> | null,
      };
    }
    // Idle past 30 min — close the old session at the time of its last turn
    // (not "now"; the session's life ended when activity stopped).
    // For >7d idle, the same close happens; the only difference is a future
    // archival cron may delete or relocate these rows.
    await db.update(sessions).set({ closedAt: lastTurnAt }).where(eq(sessions.id, recent.id));
  }

  const created = await db
    .insert(sessions)
    .values({
      userId: opts.userId,
      startedAt: now,
      lastTurnAt: now,
      turnCount: 0,
    })
    .returning({
      id: sessions.id,
      lastTurnAt: sessions.lastTurnAt,
      metadata: sessions.metadata,
    });

  if (created[0] === undefined) {
    throw new Error('session insert returned no row');
  }
  return {
    sessionId: asSessionId(created[0].id),
    isNew: true,
    turnCount: 0,
    lastTurnAt: asDate(created[0].lastTurnAt),
    metadata: created[0].metadata as Record<string, unknown> | null,
  };
}
