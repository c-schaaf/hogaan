import { eq, sql } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { sessions } from '../shared/db/schema/sessions.js';
import type { SessionId } from '../shared/types/index.js';

/**
 * Explicit close — Process #2 E2 (TurnCompletedSessionClosed) calls this when
 * the continuation decision says the user has signaled session-end.
 * Idempotent: closing an already-closed session is a no-op.
 */
export async function closeSession(
  db: Database,
  sessionId: SessionId,
  closedAt: Date = new Date(),
): Promise<{ alreadyClosed: boolean }> {
  const updated = await db
    .update(sessions)
    .set({ closedAt })
    .where(sql`${sessions.id} = ${sessionId} AND ${sessions.closedAt} IS NULL`)
    .returning({ id: sessions.id });

  return { alreadyClosed: updated.length === 0 };
}

/**
 * Bump session.last_turn_at + turn_count after a successful turn write.
 * Called from Process #2 §12 (post-turn persistence). Fail-open: caller
 * already wrote the turn row; this is bookkeeping.
 */
export async function bumpSessionAfterTurn(
  db: Database,
  sessionId: SessionId,
  lastTurnAt: Date,
): Promise<void> {
  await db
    .update(sessions)
    .set({
      lastTurnAt,
      turnCount: sql`${sessions.turnCount} + 1`,
    })
    .where(eq(sessions.id, sessionId));
}
