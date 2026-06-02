import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCoachingContext } from '../../src/coaching/context-fetch.js';
import { fakeConfig } from '../phase-10/helpers/fakes.js';
import type { Database } from '../../src/shared/db/client.js';
import type { SessionId, UserId } from '../../src/shared/types/index.js';

vi.mock('../../src/memory/index.js', () => ({
  retrieveMemories: vi.fn(),
}));

vi.mock('../../src/session-lifecycle/index.js', () => ({
  fetchRecentTurns: vi.fn(),
}));

vi.mock('../../src/incident-handling/index.js', () => ({
  reportP2: vi.fn(),
}));

const USER_ID = '00000000-0000-0000-0000-000000000001' as UserId;
const SESSION_ID = '00000000-0000-0000-0000-0000000000aa' as SessionId;

interface ProfileRow {
  role?: unknown;
  experienceBand?: unknown;
  location?: unknown;
  timezone?: unknown;
  mappedPractices?: unknown;
}

function buildDb(profileRows: ProfileRow[] | Promise<ProfileRow[]>): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(profileRows),
        }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  } as unknown as Database;
}

function buildDbWithProfileError(err: Error): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.reject(err),
        }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  } as unknown as Database;
}

function buildDbWithPendingProfile(): Database {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => new Promise<ProfileRow[]>(() => undefined),
        }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  } as unknown as Database;
}

const BASE_OPTS = {
  userId: USER_ID,
  sessionId: SESSION_ID,
  query: 'how do I delegate better?',
};

describe('fetchCoachingContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: returns profile + memories + sessionTurns with partialFailure=false', async () => {
    const { retrieveMemories } = await import('../../src/memory/index.js');
    const { fetchRecentTurns } = await import('../../src/session-lifecycle/index.js');

    const memCreatedAt = new Date('2026-05-01T10:00:00Z');
    vi.mocked(retrieveMemories).mockResolvedValue([
      {
        id: 'mem-1',
        content: 'User leads a 12-person team',
        similarity: 0.9,
        metadata: null,
        createdAt: memCreatedAt,
      },
    ]);
    vi.mocked(fetchRecentTurns).mockResolvedValue([
      {
        turnId: 't1',
        userMessage: 'hi',
        responseText: 'hello',
        createdAt: new Date('2026-05-01T11:00:00Z'),
      },
    ]);

    const db = buildDb([
      {
        role: 'eng-manager',
        experienceBand: '5-10',
        location: 'Minneapolis',
        timezone: 'America/Chicago',
        mappedPractices: ['accountability', 'empathy'],
      },
    ]);

    const result = await fetchCoachingContext({ config: fakeConfig(), db }, BASE_OPTS);

    expect(result.partialFailure).toBe(false);
    expect(result.memories).toEqual([
      { content: 'User leads a 12-person team', createdAt: memCreatedAt },
    ]);
    expect(result.profile).toEqual({
      role: 'eng-manager',
      experienceBand: '5-10',
      location: 'Minneapolis',
      timezone: 'America/Chicago',
      mappedPractices: ['accountability', 'empathy'],
    });
    expect(result.sessionTurns).toEqual([{ userMessage: 'hi', responseText: 'hello' }]);
  });

  it('memory branch throws → memories=[] AND partialFailure=true', async () => {
    const { retrieveMemories } = await import('../../src/memory/index.js');
    const { fetchRecentTurns } = await import('../../src/session-lifecycle/index.js');

    vi.mocked(retrieveMemories).mockRejectedValue(new Error('voyage down'));
    vi.mocked(fetchRecentTurns).mockResolvedValue([]);

    const db = buildDb([]);

    const result = await fetchCoachingContext({ config: fakeConfig(), db }, BASE_OPTS);

    expect(result.memories).toEqual([]);
    expect(result.partialFailure).toBe(true);
    expect(result.profile).toEqual({});
    expect(result.sessionTurns).toEqual([]);
  });

  it('profile branch throws → profile={} AND partialFailure=true', async () => {
    const { retrieveMemories } = await import('../../src/memory/index.js');
    const { fetchRecentTurns } = await import('../../src/session-lifecycle/index.js');

    vi.mocked(retrieveMemories).mockResolvedValue([]);
    vi.mocked(fetchRecentTurns).mockResolvedValue([]);

    const db = buildDbWithProfileError(new Error('pg connection lost'));

    const result = await fetchCoachingContext({ config: fakeConfig(), db }, BASE_OPTS);

    expect(result.profile).toEqual({});
    expect(result.partialFailure).toBe(true);
    expect(result.memories).toEqual([]);
    expect(result.sessionTurns).toEqual([]);
  });

  it('sessionTurns branch throws → sessionTurns=[] AND partialFailure=true', async () => {
    const { retrieveMemories } = await import('../../src/memory/index.js');
    const { fetchRecentTurns } = await import('../../src/session-lifecycle/index.js');

    vi.mocked(retrieveMemories).mockResolvedValue([]);
    vi.mocked(fetchRecentTurns).mockRejectedValue(new Error('turns query failed'));

    const db = buildDb([]);

    const result = await fetchCoachingContext({ config: fakeConfig(), db }, BASE_OPTS);

    expect(result.sessionTurns).toEqual([]);
    expect(result.partialFailure).toBe(true);
  });

  it('memoryTopN=0 short-circuits the memory fetch (retrieveMemories not called)', async () => {
    const { retrieveMemories } = await import('../../src/memory/index.js');
    const { fetchRecentTurns } = await import('../../src/session-lifecycle/index.js');

    vi.mocked(fetchRecentTurns).mockResolvedValue([]);
    const db = buildDb([]);

    const result = await fetchCoachingContext(
      { config: fakeConfig(), db },
      { ...BASE_OPTS, memoryTopN: 0 },
    );

    expect(vi.mocked(retrieveMemories)).not.toHaveBeenCalled();
    expect(result.memories).toEqual([]);
    expect(result.partialFailure).toBe(false);
  });

  it('branch that exceeds FETCH_TIMEOUT_MS (~1500ms) is timed out → partialFailure=true', async () => {
    const { retrieveMemories } = await import('../../src/memory/index.js');
    const { fetchRecentTurns } = await import('../../src/session-lifecycle/index.js');

    vi.useFakeTimers();
    try {
      vi.mocked(retrieveMemories).mockReturnValue(new Promise(() => undefined));
      vi.mocked(fetchRecentTurns).mockReturnValue(new Promise(() => undefined));
      const db = buildDbWithPendingProfile();

      const promise = fetchCoachingContext({ config: fakeConfig(), db }, BASE_OPTS);

      await vi.advanceTimersByTimeAsync(1500);

      const result = await promise;

      expect(result.partialFailure).toBe(true);
      expect(result.memories).toEqual([]);
      expect(result.profile).toEqual({});
      expect(result.sessionTurns).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
