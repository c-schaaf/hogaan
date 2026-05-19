import { and, eq } from 'drizzle-orm';
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
 *      (or doesn't exist), we fall through silently to the no-sessionId
 *      path rather than 404, to avoid leaking session existence across
 *      users.
 *   2. No sessionId (SCRUM-54): always create a new session row. The
 *      WhatsApp-era 30-min auto-continue lookup was dropped so the homepage
 *      and the explicit "New Chat" button match the ChatGPT mental model —
 *      a new conversation starts iff the client doesn't name an existing
 *      one.
 */

// Retained for archive-cron consumers; the resolver itself no longer
// branches on idle age.
export const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 minutes
export const SESSION_ARCHIVE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function resolveSession(
  db: Database,
  opts: ResolveOptions,
): Promise<SessionResolution> {
  const now = opts.now ?? new Date();

  // Mode 1: client named a specific session. Attach if it belongs to this
  // user; reopen if closed. Otherwise fall through to the new-session path.
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
