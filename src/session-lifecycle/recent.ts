import { desc, eq } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { turns } from '../shared/db/schema/turns.js';
import type { SessionId } from '../shared/types/index.js';
import type { RecentTurn } from './types.js';

/**
 * Process #2 §5c: fetch the last N turns of a session, returned oldest-first
 * so Process #9 §9 can paste them into the prompt as a User/Assistant
 * interleaved transcript.
 *
 * Default 5 — Process #9 §9 plan note: "last 3-5 turns". Caller can override.
 */
const DEFAULT_LIMIT = 5;

export async function fetchRecentTurns(
  db: Database,
  sessionId: SessionId,
  limit: number = DEFAULT_LIMIT,
): Promise<RecentTurn[]> {
  if (limit <= 0) {
    return [];
  }
  const rows = await db
    .select({
      turnId: turns.id,
      userMessage: turns.userMessage,
      responseText: turns.responseText,
      createdAt: turns.createdAt,
    })
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(desc(turns.createdAt))
    .limit(limit);

  // Reverse to oldest-first for natural transcript ordering.
  return rows.reverse().map((r) => ({
    turnId: r.turnId,
    userMessage: r.userMessage,
    responseText: r.responseText,
    createdAt: r.createdAt,
  }));
}
