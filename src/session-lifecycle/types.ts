import type { SessionId, UserId } from '../shared/types/index.js';

export interface SessionResolution {
  sessionId: SessionId;
  /** True when this resolution created a fresh session row. */
  isNew: boolean;
  turnCount: number;
  lastTurnAt: Date;
  metadata: Record<string, unknown> | null;
}

export interface RecentTurn {
  turnId: string;
  userMessage: string;
  responseText: string | null;
  createdAt: Date;
}

export interface UpdateSessionInput {
  sessionId: SessionId;
  /** When the new turn completed. Becomes session.last_turn_at. */
  lastTurnAt: Date;
}

/** Used by callers needing to start the resolver — userId is required. */
export interface ResolveOptions {
  userId: UserId;
  /**
   * When provided, attach the new turn to this session (reopening it if it
   * was closed). The session must belong to `userId`; if it doesn't, the
   * resolver falls through silently to the legacy time-based logic rather
   * than 404'ing, to avoid leaking session existence across users.
   * When omitted, the legacy 30-min auto-split logic applies.
   */
  sessionId?: SessionId;
  /** Override "now" for tests / replays. Defaults to current time. */
  now?: Date;
}
