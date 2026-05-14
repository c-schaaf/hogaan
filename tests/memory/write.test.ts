import { describe, expect, it, vi, beforeEach } from 'vitest';
import { writeMemory } from '../../src/memory/write.js';
import { fakeConfig } from '../phase-10/helpers/fakes.js';
import type { NewMemoryInput } from '../../src/memory/types.js';

vi.mock('../../src/shared/embeddings/index.js', () => ({
  embedDocument: vi.fn(),
}));

const USER_ID = '00000000-0000-0000-0000-000000000001' as never;
const SESSION_ID = 'sess-0000-0000-0000-000000000001' as never;
const TURN_ID = 'turn-0000-0000-0000-000000000001' as never;
const FAKE_EMBEDDING = Array.from({ length: 1024 }, (_, i) => i / 1024);

function buildDb(insertedId = 'mem-001') {
  const insertSpy = vi.fn().mockResolvedValue([{ id: insertedId }]);
  return {
    insert: () => ({
      values: (vals: unknown) => ({
        returning: () => insertSpy(vals),
      }),
    }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    _insertSpy: insertSpy,
  };
}

describe('writeMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls embedDocument with the content', async () => {
    const { embedDocument } = await import('../../src/shared/embeddings/index.js');
    vi.mocked(embedDocument).mockResolvedValue(FAKE_EMBEDDING);
    const db = buildDb();

    const input: NewMemoryInput = {
      userId: USER_ID,
      content: 'I struggle with delegation',
      kind: 'turn',
    };

    await writeMemory(fakeConfig(), db as never, input);

    expect(vi.mocked(embedDocument)).toHaveBeenCalledWith(
      fakeConfig(),
      'I struggle with delegation',
    );
  });

  it('inserts row with userId, content, metadata, and embedding', async () => {
    const { embedDocument } = await import('../../src/shared/embeddings/index.js');
    vi.mocked(embedDocument).mockResolvedValue(FAKE_EMBEDDING);
    const db = buildDb();

    const input: NewMemoryInput = {
      userId: USER_ID,
      content: 'User mentioned fear of public speaking',
      kind: 'event',
    };

    await writeMemory(fakeConfig(), db as never, input);

    expect(db._insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        content: 'User mentioned fear of public speaking',
        embedding: FAKE_EMBEDDING,
        metadata: { kind: 'event' },
      }),
    );
  });

  it('includes sessionId and turnId when provided', async () => {
    const { embedDocument } = await import('../../src/shared/embeddings/index.js');
    vi.mocked(embedDocument).mockResolvedValue(FAKE_EMBEDDING);
    const db = buildDb();

    const input: NewMemoryInput = {
      userId: USER_ID,
      content: 'Practice: Integrity',
      kind: 'turn',
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    };

    await writeMemory(fakeConfig(), db as never, input);

    expect(db._insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID, turnId: TURN_ID }),
    );
  });

  it('merges extraMetadata into metadata object', async () => {
    const { embedDocument } = await import('../../src/shared/embeddings/index.js');
    vi.mocked(embedDocument).mockResolvedValue(FAKE_EMBEDDING);
    const db = buildDb();

    const input: NewMemoryInput = {
      userId: USER_ID,
      content: 'Team size 12',
      kind: 'fact',
      extraMetadata: { source: 'profile', version: 2 },
    };

    await writeMemory(fakeConfig(), db as never, input);

    expect(db._insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { kind: 'fact', source: 'profile', version: 2 },
      }),
    );
  });

  it('returns { id } from the inserted row', async () => {
    const { embedDocument } = await import('../../src/shared/embeddings/index.js');
    vi.mocked(embedDocument).mockResolvedValue(FAKE_EMBEDDING);
    const db = buildDb('mem-xyz-001');

    const input: NewMemoryInput = { userId: USER_ID, content: 'test', kind: 'turn' };
    const result = await writeMemory(fakeConfig(), db as never, input);

    expect(result).toEqual({ id: 'mem-xyz-001' });
  });

  it('throws when embedDocument fails', async () => {
    const { embedDocument } = await import('../../src/shared/embeddings/index.js');
    vi.mocked(embedDocument).mockRejectedValue(new Error('embed API down'));
    const db = buildDb();

    const input: NewMemoryInput = { userId: USER_ID, content: 'test', kind: 'turn' };

    await expect(writeMemory(fakeConfig(), db as never, input)).rejects.toThrow('embed API down');
  });
});
