import { describe, expect, it, vi, beforeEach } from 'vitest';
import { retrieveMemories } from '../../src/memory/read.js';
import { fakeConfig } from '../phase-10/helpers/fakes.js';

vi.mock('../../src/shared/embeddings/index.js', () => ({
  embedQuery: vi.fn(),
}));

const USER_ID = '00000000-0000-0000-0000-000000000001' as never;
const FAKE_EMBEDDING = Array.from({ length: 1024 }, (_, i) => i / 1024);

function buildDb(rows: unknown[] = []) {
  return {
    execute: vi.fn().mockResolvedValue(rows),
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  };
}

describe('retrieveMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls embedQuery with the query text', async () => {
    const { embedQuery } = await import('../../src/shared/embeddings/index.js');
    vi.mocked(embedQuery).mockResolvedValue(FAKE_EMBEDDING);
    const db = buildDb([]);

    await retrieveMemories(fakeConfig(), db as never, USER_ID, 'delegation challenges');

    expect(vi.mocked(embedQuery)).toHaveBeenCalledWith(fakeConfig(), 'delegation challenges');
  });

  it('returns MemorySearchResult[] with correct shape including similarity as number', async () => {
    const { embedQuery } = await import('../../src/shared/embeddings/index.js');
    vi.mocked(embedQuery).mockResolvedValue(FAKE_EMBEDDING);

    const now = new Date('2026-05-01T10:00:00Z');
    const db = buildDb([
      {
        id: 'mem-1',
        content: 'User leads a team of 12',
        metadata: { kind: 'turn' },
        similarity: '0.92',
        created_at: now,
      },
    ]);

    const results = await retrieveMemories(fakeConfig(), db as never, USER_ID, 'team size');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'mem-1',
      content: 'User leads a team of 12',
      metadata: { kind: 'turn' },
      similarity: 0.92,
    });
    expect(typeof results[0]!.similarity).toBe('number');
  });

  it('returns empty array when topN=0 without calling embedQuery', async () => {
    const { embedQuery } = await import('../../src/shared/embeddings/index.js');
    const db = buildDb([
      {
        id: 'mem-1',
        content: 'anything',
        metadata: null,
        similarity: '0.9',
        created_at: new Date(),
      },
    ]);

    const results = await retrieveMemories(fakeConfig(), db as never, USER_ID, 'query', 0);

    expect(results).toEqual([]);
    expect(vi.mocked(embedQuery)).not.toHaveBeenCalled();
  });

  it('createdAt is a Date object (not raw string)', async () => {
    const { embedQuery } = await import('../../src/shared/embeddings/index.js');
    vi.mocked(embedQuery).mockResolvedValue(FAKE_EMBEDDING);

    const isoString = '2026-04-15T08:30:00.000Z';
    const db = buildDb([
      {
        id: 'mem-2',
        content: 'something',
        metadata: null,
        similarity: '0.8',
        created_at: isoString,
      },
    ]);

    const results = await retrieveMemories(fakeConfig(), db as never, USER_ID, 'something');

    expect(results[0]!.createdAt).toBeInstanceOf(Date);
  });

  it('returns empty array when no rows found', async () => {
    const { embedQuery } = await import('../../src/shared/embeddings/index.js');
    vi.mocked(embedQuery).mockResolvedValue(FAKE_EMBEDDING);
    const db = buildDb([]);

    const results = await retrieveMemories(fakeConfig(), db as never, USER_ID, 'nothing');

    expect(results).toEqual([]);
  });

  it('returns multiple results in order returned by DB', async () => {
    const { embedQuery } = await import('../../src/shared/embeddings/index.js');
    vi.mocked(embedQuery).mockResolvedValue(FAKE_EMBEDDING);

    const now = new Date();
    const db = buildDb([
      { id: 'mem-a', content: 'first', metadata: null, similarity: '0.95', created_at: now },
      { id: 'mem-b', content: 'second', metadata: null, similarity: '0.80', created_at: now },
      { id: 'mem-c', content: 'third', metadata: null, similarity: '0.70', created_at: now },
    ]);

    const results = await retrieveMemories(fakeConfig(), db as never, USER_ID, 'query', 3);

    expect(results).toHaveLength(3);
    expect(results[0]!.id).toBe('mem-a');
    expect(results[1]!.id).toBe('mem-b');
    expect(results[2]!.id).toBe('mem-c');
  });
});
