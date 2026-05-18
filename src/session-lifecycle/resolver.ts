import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { asDate } from '../shared/db/dates.js';
import { sessions } from '../shared/db/schema/sessions.js';
import { asSessionId } from '../shared/types/index.js';
import type { ResolveOptions, SessionResolution } from './types.js';

/**
 * Session resolver — see docs/bpmn/05-session-lifecycle.md for the full flow.
 *
 * Two modes:
 *   1. Client-named session (SCRUM-53): caller passes opts.sessionId. If it
 *      belongs to opts.userId, we attach to it — reopening (clearing
 *      closedAt) if it had been closed. If it doesn't belong to the user
 *      (or doesn't exist), we fall through silently to the legacy logic
 *      rather than 404, to avoid leaking session existence across users.
 *   2. No sessionId (legacy time-based):
 *      - <=30-min idle → continue the user's most-recent open session
 *      - >30-min idle  → close the old session, open a new one
 *      - >7d idle      → same as above (a future archival cron handles
 *        deletion of dormant rows)
 *
 * Concurrency note: two near-simultaneous inbound messages for the same user
 * with no sessionId could race here and produce two new sessions. Rare for
 * our scale, and downstream merging is cheap. If it becomes a problem, wrap
 * in the same advisory-lock pattern as the identity audit-log path.
 */

export const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 minutes
export const SESSION_ARCHIVE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function resolveSession(
  db: Database,
  opts: ResolveOptions,
): Promise<SessionResolution> {
  const now = opts.now ?? new Date();

  // Mode 1: client named a specific session. Attach if it belongs to this
  // user; reopen if closed. Otherwise fall through to legacy logic.
  if (opts.sessionId !== undefined) {
    const named = await db
      .select({
        id: sessions.id,
        lastTurnAt: sessions.lastTurnAt,
        turnCount: sessions.turnCount,
        metadata: sessions.metadata,
        closedAt: sessions.closedAt,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, opts.userId), eq(sessions.id, opts.sessionId)))
      .limit(1);

    const owned = named[0];
    if (owned !== undefined) {
      if (owned.closedAt !== null) {
        await db.update(sessions).set({ closedAt: null }).where(eq(sessions.id, owned.id));
      }
      return {
        sessionId: asSessionId(owned.id),
        isNew: false,
        turnCount: owned.turnCount,
        lastTurnAt: asDate(owned.lastTurnAt),
        metadata: owned.metadata as Record<string, unknown> | null,
      };
    }
    // Foreign or fabricated sessionId — silently fall through.
  }

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
