import type { SessionId, TurnId, UserId } from '../shared/types/index.js';

/**
 * Process #8 memory record. Three kinds, distinguished in `metadata.kind`:
 *   - 'turn'  : auto-extracted from a coaching turn
 *   - 'event' : user told us something durable ("I got promoted")
 *   - 'fact'  : curated profile bit (rare; ops-curated)
 *
 * Indefinite retention for "active" users — Phase 4B plan flagged that
 * "active" needs definition. Until then, no auto-deletion.
 */
export type MemoryKind = 'turn' | 'event' | 'fact';

export interface NewMemoryInput {
  userId: UserId;
  /** The text we want to remember. The embedding is computed from this. */
  content: string;
  kind: MemoryKind;
  /** Optional pointers back to the originating session/turn. */
  sessionId?: SessionId;
  turnId?: TurnId;
  /** Free-form structured metadata stored alongside the kind. */
  extraMetadata?: Record<string, unknown>;
}

export interface MemorySearchResult {
  id: string;
  content: string;
  /** Cosine similarity in [-1, 1]. 1.0 = identical, 0 = orthogonal. */
  similarity: number;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}
