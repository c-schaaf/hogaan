import type {
  Intent,
  LevelTag,
  PhoneE164,
  PracticeTag,
  SessionId,
  TurnId,
  UserId,
} from '../shared/types/index.js';
import type { CoachingEndEvent } from './end-events.js';

/**
 * Process #2 input: a single inbound user message. Identity (#12) has
 * already resolved userId before this is constructed.
 */
export interface CoachingInbound {
  userId: UserId;
  /** Plaintext E.164 — the recipient on outbound responses. For web users
   *  pass a stable synthetic value (`web:<userId>`); dispatch is skipped. */
  phoneE164: PhoneE164;
  /** SHA-256 of phoneE164 — for trace + suppression checks. */
  phoneHash: string;
  /** Plaintext user message body. */
  body: string;
  /** Optional inbound media URLs. Non-empty triggers Step 1 media branch. */
  mediaUrls: string[];
  /** Inbound provider message id — for trace propagation + idempotency. */
  inboundMessageId: string;
  receivedAt: Date;
  /** Trace ID — typically the Fastify request ID propagated from the caller. */
  traceId: string;
  /**
   * Delivery channel. The legacy 'whatsapp' value is retained for the
   * type union so historical fixtures still parse; the live path is 'web',
   * which short-circuits external dispatch and returns the responseText
   * via HTTP instead.
   */
  channel?: 'whatsapp' | 'web';
  /**
   * Web "Private session" toggle. When true, downstream persistence
   * (post-turn writes, memory) is skipped for this turn. See
   * sessions.is_private column.
   */
  isPrivate?: boolean;
}

/** Triage outcome (Step 1). */
export type TriageStatus = 'valid' | 'empty' | 'media_only' | 'reject';

export interface TriageResult {
  status: TriageStatus;
  /** Human-readable cause for trace + audit. No PII. */
  reason: string;
  /** When the LLM-side classifier ran, the intent it returned. Step 4 uses this. */
  intent?: Intent;
}

/** Step 5 context-fetch outcome. Each field independently nullable on partial failure. */
export interface CoachingContext {
  memories: { content: string; createdAt: Date }[];
  profile: {
    role?: string;
    /** Customer-feedback PR4 — leadership experience band: '<5' | '5-10' | '10+'. */
    experienceBand?: string;
    location?: string;
    timezone?: string;
    mappedPractices?: PracticeTag[];
  };
  sessionTurns: { userMessage: string; responseText: string | null }[];
  /** True when one or more branches failed-soft and returned empty. */
  partialFailure: boolean;
}

export interface CoachingTurnResult {
  endEvent: CoachingEndEvent;
  /** When the response was dispatched, this is its body. Empty for crisis/silent-drop/etc. */
  responseText: string;
  /** Provider message id when delivery succeeded. */
  waMessageId?: string;
  /** Practice + level the turn anchored on (if applicable). */
  practiceTag: PracticeTag | null;
  levelTag: LevelTag | null;
  /** End-to-end latency from inbound receipt to dispatch confirmation. */
  latencyMs: number;
  /** Session ID this turn ran in. */
  sessionId: SessionId;
  turnId: TurnId | null;
  /** Trace ID echoed for log correlation. */
  traceId: string;
  /** Sanitized failure detail when endEvent is not E1/E2. */
  reason?: string;
}

export class CoachingError extends Error {
  public readonly endEvent: CoachingEndEvent;
  constructor(message: string, endEvent: CoachingEndEvent) {
    super(message);
    this.name = 'CoachingError';
    this.endEvent = endEvent;
  }
}
