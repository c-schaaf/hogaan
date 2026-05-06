import { beforeEach, describe, expect, it, vi } from 'vitest';
import { persistShortCircuitTurn } from '../../src/coaching/post-turn.js';
import {
  asSessionId,
  asTurnId,
  asUserId,
  type SessionId,
  type TurnId,
  type UserId,
} from '../../src/shared/types/index.js';
import type { Database } from '../../src/shared/db/client.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

/**
 * Phase 12 R20+R21 — short-circuit turn persistence.
 *
 * persistShortCircuitTurn writes a lightweight turn row + memory entry +
 * session bump for templated responses (greeting, affirmation, meta,
 * profile-ack). The full coaching pipeline's persistPostTurn covers the
 * LLM path; this helper covers the no-LLM path.
 *
 * Mocks the DB and writeMemory boundaries; asserts each branch fires.
 */

vi.mock('../../src/memory/index.js', () => ({
  writeMemory: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/session-lifecycle/index.js', () => ({
  bumpSessionAfterTurn: vi.fn(() => Promise.resolve()),
}));

const TEST_USER_ID: UserId = asUserId('00000000-0000-0000-0000-00000000abcd');
const TEST_SESSION_ID: SessionId = asSessionId('00000000-0000-0000-0000-00000000beef');
const FAKE_TURN_ID: TurnId = asTurnId('11111111-1111-1111-1111-111111111111');

interface DbCalls {
  insertCalls: number;
  lastInsertValues: Record<string, unknown> | null;
}

function fakeDb(calls: DbCalls): Database {
  return {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        calls.insertCalls += 1;
        calls.lastInsertValues = v;
        return {
          returning: () => Promise.resolve([{ id: FAKE_TURN_ID }]),
        };
      },
    }),
  } as unknown as Database;
}

function freshCalls(): DbCalls {
  return { insertCalls: 0, lastInsertValues: null };
}

const cfg: AppConfig = { logLevel: 'error' } as AppConfig;

beforeEach(async () => {
  const mem = await import('../../src/memory/index.js');
  vi.mocked(mem.writeMemory).mockClear();
  const sess = await import('../../src/session-lifecycle/index.js');
  vi.mocked(sess.bumpSessionAfterTurn).mockClear();
});

describe('Phase 12 R20 — persistShortCircuitTurn writes turn row', () => {
  it('inserts a turn row for greeting (response_mode NULL)', async () => {
    const calls = freshCalls();
    const result = await persistShortCircuitTurn(
      { config: cfg, db: fakeDb(calls) },
      {
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
        userMessage: 'salaam',
        responseText: 'Salaam back.',
        callerSubId: 'greeting',
        intent: 'Greeting',
        terminalEvent: 'E1_TurnCompleted',
        latencyMs: 25,
        deliveryReceipt: { waMessageId: 'SM-test' },
      },
    );

    expect(result.turnId).toBe(FAKE_TURN_ID);
    expect(calls.insertCalls).toBe(1);
    expect(calls.lastInsertValues).toMatchObject({
      userId: TEST_USER_ID,
      sessionId: TEST_SESSION_ID,
      intent: 'Greeting',
      qaOutcome: 'short_circuit',
      modelUsed: 'none',
      retryCount: 0,
    });
    // greeting → no responseMode (it's not set)
    expect(calls.lastInsertValues?.['responseMode']).toBeUndefined();
  });

  it('inserts response_mode=MetaResponse for meta callerSubId', async () => {
    const calls = freshCalls();
    await persistShortCircuitTurn(
      { config: cfg, db: fakeDb(calls) },
      {
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
        userMessage: 'who are you?',
        responseText: 'I am Hogaan',
        callerSubId: 'meta',
        intent: 'MetaQuestion',
        terminalEvent: 'E6_MetaResponse',
        latencyMs: 30,
        deliveryReceipt: {},
      },
    );
    expect(calls.lastInsertValues?.['responseMode']).toBe('MetaResponse');
  });

  it('inserts response_mode=ProfileUpdateAcknowledgment for profile-ack', async () => {
    const calls = freshCalls();
    await persistShortCircuitTurn(
      { config: cfg, db: fakeDb(calls) },
      {
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
        userMessage: 'I got promoted',
        responseText: 'Heard',
        callerSubId: 'profile-ack',
        intent: 'ProfileUpdate',
        terminalEvent: 'E5_ProfileAck',
        latencyMs: 30,
        deliveryReceipt: {},
      },
    );
    expect(calls.lastInsertValues?.['responseMode']).toBe('ProfileUpdateAcknowledgment');
  });
});

describe('Phase 12 R21 — persistShortCircuitTurn writes memory entry', () => {
  it('writes memory with user message + templated response after turn insert', async () => {
    const calls = freshCalls();
    const memMod = await import('../../src/memory/index.js');
    const memSpy = vi.mocked(memMod.writeMemory);

    const result = await persistShortCircuitTurn(
      { config: cfg, db: fakeDb(calls) },
      {
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
        userMessage: 'thanks, that helps',
        responseText: 'Glad it landed.',
        callerSubId: 'affirmation',
        intent: 'Affirmation',
        terminalEvent: 'E1_TurnCompleted',
        latencyMs: 12,
        deliveryReceipt: {},
      },
    );

    expect(result.memoryWritten).toBe(true);
    expect(memSpy).toHaveBeenCalledTimes(1);
    const memArg = memSpy.mock.calls[0]![2] as {
      content: string;
      kind: string;
      turnId?: TurnId;
      extraMetadata?: Record<string, unknown>;
    };
    expect(memArg.content).toContain('User: thanks, that helps');
    expect(memArg.content).toContain('Hogaan: Glad it landed.');
    expect(memArg.kind).toBe('turn');
    expect(memArg.turnId).toBe(FAKE_TURN_ID);
    expect(memArg.extraMetadata?.['intent']).toBe('Affirmation');
  });

  it('skips memory write when turn insert fails', async () => {
    const failingDb = {
      insert: () => ({
        values: () => ({
          returning: () => Promise.reject(new Error('db down')),
        }),
      }),
    } as unknown as Database;
    const memMod = await import('../../src/memory/index.js');
    const memSpy = vi.mocked(memMod.writeMemory);

    const result = await persistShortCircuitTurn(
      { config: cfg, db: failingDb },
      {
        userId: TEST_USER_ID,
        sessionId: TEST_SESSION_ID,
        userMessage: 'salaam',
        responseText: 'Salaam back.',
        callerSubId: 'greeting',
        intent: 'Greeting',
        terminalEvent: 'E1_TurnCompleted',
        latencyMs: 25,
        deliveryReceipt: {},
      },
    );

    // Fail-open: returns null turnId, doesn't throw.
    expect(result.turnId).toBeNull();
    expect(result.memoryWritten).toBe(false);
    expect(memSpy).not.toHaveBeenCalled();
  });
});
