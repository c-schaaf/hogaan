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
  /** Override "now" for tests / replays. Defaults to current time. */
  now?: Date;
}
