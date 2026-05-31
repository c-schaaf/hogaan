import { describe, expect, it, vi, beforeEach } from 'vitest';
import { generateSessionTitle } from '../../src/web-api/session-title.js';
import { fakeConfig } from '../phase-10/helpers/fakes.js';

vi.mock('../../src/shared/llm/chat.js', () => ({
  chat: vi.fn(),
}));

vi.mock('../../src/incident-handling/index.js', () => ({
  reportP2: vi.fn(),
}));

const SESSION_ID = 'sess-0000-0000-0000-000000000001';

function buildDb(opts: {
  existingTitle?: string | null;
  updateSpy?: ReturnType<typeof vi.fn>;
  firstTurnMessage?: string | null;
}) {
  const {
    existingTitle = null,
    updateSpy = vi.fn().mockResolvedValue([]),
    firstTurnMessage = null,
  } = opts;

  // The mock returns the SAME shape for every SELECT chain. Pre-F9 the only
  // SELECT in this function read `sessions.title`. After F9 there's a second
  // SELECT that reads `turns.userMessage` (to fetch the session's first
  // message). The chain now supports `where().orderBy().limit()` AND
  // `where().limit()`, and the returned row carries BOTH fields so the
  // calling code picks whichever it asked for.
  const queryResult = Promise.resolve([{ title: existingTitle, userMessage: firstTurnMessage }]);
  const whereChain = {
    limit: () => queryResult,
    orderBy: () => ({ limit: () => queryResult }),
  };

  return {
    select: () => ({
      from: () => ({
        where: () => whereChain,
      }),
    }),
    update: () => ({ set: (vals: unknown) => ({ where: () => updateSpy(vals) }) }),
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    _updateSpy: updateSpy,
  };
}

describe('generateSessionTitle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early when session already has a title', async () => {
    const { chat } = await import('../../src/shared/llm/chat.js');
    const db = buildDb({ existingTitle: 'Existing Title' });

    await generateSessionTitle(fakeConfig(), db as never, SESSION_ID, 'some message');

    expect(vi.mocked(chat)).not.toHaveBeenCalled();
    expect(db._updateSpy).not.toHaveBeenCalled();
  });

  it('returns early for pending sessionId', async () => {
    const { chat } = await import('../../src/shared/llm/chat.js');
    const db = buildDb({});

    await generateSessionTitle(fakeConfig(), db as never, 'pending', 'some message');

    expect(vi.mocked(chat)).not.toHaveBeenCalled();
  });

  it('calls chat with the user message and saves the title', async () => {
    const { chat } = await import('../../src/shared/llm/chat.js');
    vi.mocked(chat).mockResolvedValue({ text: 'Managing Remote Team Dynamics' } as never);

    const updateSpy = vi.fn().mockResolvedValue([]);
    const db = buildDb({ existingTitle: null, updateSpy });

    await generateSessionTitle(
      fakeConfig(),
      db as never,
      SESSION_ID,
      'How do I lead my remote team?',
    );

    expect(vi.mocked(chat)).toHaveBeenCalledOnce();
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Managing Remote Team Dynamics' }),
    );
  });

  it('strips leading and trailing quotes from LLM response', async () => {
    const { chat } = await import('../../src/shared/llm/chat.js');
    vi.mocked(chat).mockResolvedValue({ text: '"Leading With Empathy"' } as never);

    const updateSpy = vi.fn().mockResolvedValue([]);
    const db = buildDb({ existingTitle: null, updateSpy });

    await generateSessionTitle(fakeConfig(), db as never, SESSION_ID, 'empathy question');

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Leading With Empathy' }),
    );
  });

  it('saves fallback when LLM throws', async () => {
    const { chat } = await import('../../src/shared/llm/chat.js');
    vi.mocked(chat).mockRejectedValue(new Error('LLM timeout'));

    const updateSpy = vi.fn().mockResolvedValue([]);
    const db = buildDb({ existingTitle: null, updateSpy });

    await generateSessionTitle(fakeConfig(), db as never, SESSION_ID, 'some message');

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Personal reflection' }),
    );
  });

  it('saves fallback when LLM returns > 120 chars', async () => {
    const { chat } = await import('../../src/shared/llm/chat.js');
    vi.mocked(chat).mockResolvedValue({ text: 'A'.repeat(121) } as never);

    const updateSpy = vi.fn().mockResolvedValue([]);
    const db = buildDb({ existingTitle: null, updateSpy });

    await generateSessionTitle(fakeConfig(), db as never, SESSION_ID, 'long title message');

    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Personal reflection' }),
    );
  });

  it('saves title to sessions table via DB update', async () => {
    const { chat } = await import('../../src/shared/llm/chat.js');
    vi.mocked(chat).mockResolvedValue({ text: 'Decision Under Pressure' } as never);

    const updateSpy = vi.fn().mockResolvedValue([]);
    const db = buildDb({ existingTitle: null, updateSpy });

    await generateSessionTitle(fakeConfig(), db as never, SESSION_ID, 'hard decision message');

    expect(updateSpy).toHaveBeenCalledOnce();
  });
});
