import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWebApiRoutes } from '../../src/web-api/routes.js';
import {
  fakeConfig,
  fakeRateLimiters,
  fakeRedis,
  fakeTraceEmitter,
} from '../phase-10/helpers/fakes.js';

/**
 * SCRUM — Hard Rule #3 / privacy contract. The audit found that private
 * turns were being written to the `turns` table despite the schema header
 * stating they should not be persisted. The fix gates the transaction
 * (insert + bump) on `!isPrivate`. This test asserts the gate: with
 * private:true, the route must not open the persistence transaction.
 */

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const SESSION_ID = 'sess-priv-0001';

vi.mock('../../src/web-api/supabase-session.js', () => ({
  requireSupabaseSession: vi.fn(),
}));
vi.mock('../../src/session-lifecycle/index.js', () => ({
  resolveSession: vi.fn(),
}));
vi.mock('../../src/coaching/context-fetch.js', () => ({
  fetchCoachingContext: vi.fn(),
}));
vi.mock('../../src/prompt-assembly/index.js', () => ({
  assemblePrompt: vi.fn(),
  PromptAssemblyError: class PromptAssemblyError extends Error {},
}));
vi.mock('../../src/shared/llm/chat.js', () => ({
  chatStream: vi.fn(),
}));
vi.mock('../../src/web-api/session-title.js', () => ({
  generateSessionTitle: vi.fn(),
}));

interface TrackingDb {
  transaction: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
}

function buildTrackingDb(): TrackingDb {
  const select = vi.fn(() => ({
    from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
  }));
  const insert = vi.fn(() => ({
    values: () => ({ returning: () => Promise.resolve([{ id: 'turn-1' }]) }),
  }));
  const update = vi.fn(() => ({
    set: () => ({ where: () => Promise.resolve([]) }),
  }));
  const del = vi.fn(() => ({ where: () => Promise.resolve([]) }));
  const transaction = vi.fn(async (cb: (tx: TrackingDb) => Promise<unknown>) => {
    // Hand the same tracking object back as the tx — lets us assert that
    // insert / update were invoked inside the transaction callback.
    return cb({ select, insert, update, delete: del, transaction });
  });
  return { select, insert, update, delete: del, transaction };
}

async function buildApp(db: TrackingDb) {
  const { requireSupabaseSession } = await import('../../src/web-api/supabase-session.js');
  vi.mocked(requireSupabaseSession).mockResolvedValue({ userId: TEST_USER_ID } as never);

  const { resolveSession } = await import('../../src/session-lifecycle/index.js');
  vi.mocked(resolveSession).mockResolvedValue({
    sessionId: SESSION_ID as never,
    isNew: true,
    turnCount: 0,
    lastTurnAt: new Date(),
    metadata: null,
  });

  const { fetchCoachingContext } = await import('../../src/coaching/context-fetch.js');
  vi.mocked(fetchCoachingContext).mockResolvedValue({
    profile: {} as never,
    sessionTurns: [],
    memories: [],
  });

  const { assemblePrompt } = await import('../../src/prompt-assembly/index.js');
  vi.mocked(assemblePrompt).mockResolvedValue({
    endEvent: 'E1_PromptAssembledNormal',
    assembledPrompt: 'prompt',
  } as never);

  const { chatStream } = await import('../../src/shared/llm/chat.js');
  vi.mocked(chatStream).mockImplementation(
    () =>
      (async function* () {
        yield 'ok';
        return { modelUsed: 'claude-haiku-4-5' };
      })() as never,
  );

  const app = Fastify({ logger: false });
  registerWebApiRoutes(app, {
    config: fakeConfig(),
    db: db as never,
    redis: fakeRedis(),
    rateLimiters: fakeRateLimiters(),
    traceEmitter: fakeTraceEmitter(),
  });
  await app.ready();
  return app;
}

describe('POST /api/chat/turn/stream — private session persistence gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT open a persistence transaction when private:true', async () => {
    const db = buildTrackingDb();
    const app = await buildApp(db);
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'private reflection', private: true },
    });

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('does NOT insert into any table when private:true', async () => {
    const db = buildTrackingDb();
    const app = await buildApp(db);
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'private reflection', private: true },
    });

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('DOES open a transaction (insert + bump) when private:false', async () => {
    const db = buildTrackingDb();
    const app = await buildApp(db);
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'saved turn', private: false },
    });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalled();
  });

  it('does NOT generate a session title for private turns', async () => {
    const db = buildTrackingDb();
    const app = await buildApp(db);
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'private reflection', private: true },
    });

    const { generateSessionTitle } = await import('../../src/web-api/session-title.js');
    expect(vi.mocked(generateSessionTitle)).not.toHaveBeenCalled();
  });
});
