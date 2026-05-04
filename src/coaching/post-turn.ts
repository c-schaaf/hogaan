import { eq } from 'drizzle-orm';
import { writeMemory } from '../memory/index.js';
import { reportP1 } from '../incident-handling/index.js';
import { bumpSessionAfterTurn } from '../session-lifecycle/index.js';
import type { Database } from '../shared/db/client.js';
import { turns } from '../shared/db/schema/turns.js';
import { users } from '../shared/db/schema/users.js';
import type { AppConfig } from '../shared/secrets/config.js';
import type { LevelTag, PracticeTag, SessionId, TurnId, UserId } from '../shared/types/index.js';
import { asTurnId } from '../shared/types/index.js';
import type { ResponseMode } from '../shared/types/index.js';

/**
 * Process #2 Step 12 — fail-open parallel post-turn persistence. Four
 * independent branches:
 *   (a) Insert turn row
 *   (b) Memory write (Voyage embedding)
 *   (c) Session bookkeeping (last_turn_at, turn_count)
 *   (d) Profile pattern detection — Phase 7 stub; Phase 8/9 wires real
 *       pattern updates.
 *
 * All four run in parallel. None blocks the join. Failures emit P1 incidents
 * but do NOT propagate — the user has already received the response by the
 * time we run this.
 */

interface PostTurnDeps {
  config: AppConfig;
  db: Database;
}

export interface PostTurnInput {
  userId: UserId;
  sessionId: SessionId;
  userMessage: string;
  responseText: string;
  intent: string;
  practiceTag: PracticeTag | null;
  levelTag: LevelTag | null;
  responseMode: ResponseMode;
  modelUsed: string;
  fallbackPath: string;
  qaOutcome: string;
  retryCount: number;
  latencyMs: number;
  degradationFlags: Record<string, boolean>;
  libraryVersions: unknown;
  determinismHash: string;
  deliveryReceipt: { waMessageId?: string };
  terminalEvent: string;
  /** Now timestamp — defaults to Date.now() at call time. */
  completedAt?: Date;
}

export interface PostTurnResult {
  /** Always set when the turn row insert succeeded. */
  turnId: TurnId | null;
  /** Per-branch success flags for trace + audit. */
  flags: {
    turnInserted: boolean;
    memoryWritten: boolean;
    sessionBumped: boolean;
  };
}

export async function persistPostTurn(
  deps: PostTurnDeps,
  input: PostTurnInput,
): Promise<PostTurnResult> {
  const completedAt = input.completedAt ?? new Date();

  const turnInsert = (async (): Promise<TurnId | null> => {
    try {
      const inserted = await deps.db
        .insert(turns)
        .values({
          sessionId: input.sessionId,
          userId: input.userId,
          userMessage: input.userMessage,
          responseText: input.responseText,
          intent: input.intent,
          ...(input.practiceTag !== null ? { practiceTag: input.practiceTag } : {}),
          ...(input.levelTag !== null ? { levelTag: input.levelTag } : {}),
          responseMode: input.responseMode,
          modelUsed: input.modelUsed,
          fallbackPath: input.fallbackPath,
          qaOutcome: input.qaOutcome,
          retryCount: input.retryCount,
          latencyMs: input.latencyMs,
          degradationFlags: input.degradationFlags,
          libraryVersions: input.libraryVersions,
          determinismHash: input.determinismHash,
          deliveryReceipt: input.deliveryReceipt,
          terminalEvent: input.terminalEvent,
          createdAt: completedAt,
        })
        .returning({ id: turns.id });
      return inserted[0] !== undefined ? asTurnId(inserted[0].id) : null;
    } catch (err) {
      reportP1(
        'post-turn turn-row insert failed (fail-open)',
        {
          source: 'Process_2.Step_12a.TurnRow',
          extra: {
            userId: input.userId,
            sessionId: input.sessionId,
            terminalEvent: input.terminalEvent,
          },
        },
        err,
      );
      return null;
    }
  })();

  // Memory write needs the turn id, so it depends on turnInsert. We chain
  // it but still don't await turnInsert before kicking off session-bump.
  const memoryWrite = turnInsert.then(async (turnId) => {
    if (turnId === null) {
      return false;
    }
    try {
      // Combine user message + response into a single durable memory.
      // Keeps the embedding semantically anchored on the exchange.
      const memoryContent = `User: ${input.userMessage}\nHogaan: ${input.responseText}`;
      await writeMemory(deps.config, deps.db, {
        userId: input.userId,
        content: memoryContent,
        kind: 'turn',
        sessionId: input.sessionId,
        turnId,
        extraMetadata: {
          ...(input.practiceTag !== null ? { practice: input.practiceTag } : {}),
          ...(input.levelTag !== null ? { level: input.levelTag } : {}),
          intent: input.intent,
        },
      });
      return true;
    } catch (err) {
      reportP1(
        'post-turn memory write failed (fail-open)',
        {
          source: 'Process_2.Step_12b.MemoryWrite',
          extra: { userId: input.userId, sessionId: input.sessionId },
        },
        err,
      );
      return false;
    }
  });

  const sessionBump = (async (): Promise<boolean> => {
    try {
      await bumpSessionAfterTurn(deps.db, input.sessionId, completedAt);
      return true;
    } catch (err) {
      reportP1(
        'post-turn session bump failed (fail-open)',
        {
          source: 'Process_2.Step_12c.SessionBump',
          extra: { userId: input.userId, sessionId: input.sessionId },
        },
        err,
      );
      return false;
    }
  })();

  // Profile pattern detection (Step 12d) is a Phase 8/9 task — keep the
  // hook here so the join-shape matches the BPMN.
  const profilePatterns = (async (): Promise<boolean> => {
    // Phase 7 stub: confirm the user row still exists; Phase 8/9 will detect
    // recurring practice/level focus and update users.mapped_practices.
    try {
      await deps.db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1);
      return true;
    } catch {
      return false;
    }
  })();

  const [turnId, memoryOk, sessionOk, _patternsOk] = await Promise.all([
    turnInsert,
    memoryWrite,
    sessionBump,
    profilePatterns,
  ]);

  return {
    turnId,
    flags: {
      turnInserted: turnId !== null,
      memoryWritten: memoryOk,
      sessionBumped: sessionOk,
    },
  };
}
