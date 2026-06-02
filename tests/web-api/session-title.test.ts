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
  /**
   * SCRUM-F9 — distinct result for the second SELECT (turns.userMessage),
   * separate from the first SELECT (sessions.title). When omitted, falls
   * back to firstTurnMessage so existing tests behave unchanged.
   */
  turnsFirstUserMessage?: string | null;
}) {
  const {
    existingTitle = null,
    updateSpy = vi.fn().mockResolvedValue([]),
    firstTurnMessage = null,
    turnsFirstUserMessage,
  } = opts;

  // Dispatch per-table so the title-precheck SELECT (sessions) and the
  // first-turn SELECT (turns) can return DIFFERENT values. Drizzle stores
  // the table name under Symbol.for('drizzle:Name'); read it on the
  // `.from(table)` argument and pick the matching result.
  const drizzleNameSym = Symbol.for('drizzle:Name');
  const turnsResult =
    turnsFirstUserMessage !== undefined ? turnsFirstUserMessage : firstTurnMessage;
  const sessionsRow = Promise.resolve([{ title: existingTitle }]);
  const turnsRow = Promise.resolve([{ userMessage: turnsResult }]);

  return {
    select: () => ({
      from: (table: unknown) => {
        const tableName = (table as Record<symbol, unknown>)[drizzleNameSym];
        const result = tableName === 'turns' ? turnsRow : sessionsRow;
        const whereChain = {
          limit: () => result,
          orderBy: () => ({ limit: () => result }),
        };
        return { where: () => whereChain };
      },
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

  // SCRUM-F9 — title generation now defers to the user's 3rd turn but the
  // title should still summarise the OPENING leadership topic. The function
  // pulls the first turn's userMessage from the `turns` SELECT and titles
  // from THAT, not the caller's (3rd-turn) userMessage arg.
  it('titles from the first-turn userMessage, not the caller userMessage', async () => {
    const { chat } = await import('../../src/shared/llm/chat.js');
    vi.mocked(chat).mockResolvedValue({ text: 'Opening Topic Title' } as never);

    const db = buildDb({
      existingTitle: null,
      turnsFirstUserMessage: 'FIRST_TURN_TEXT',
    });

    await generateSessionTitle(fakeConfig(), db as never, SESSION_ID, 'THIRD_TURN_TEXT');

    expect(vi.mocked(chat)).toHaveBeenCalledOnce();
    const args = vi.mocked(chat).mock.calls[0]!;
    const promptArg = args[1] as { messages: Array<{ role: string; content: string }> };
    expect(promptArg.messages).toEqual([{ role: 'user', content: 'FIRST_TURN_TEXT' }]);
  });

  // SCRUM-F9 — when the `turns` SELECT returns nothing (race, deletion, etc.)
  // the function falls back to the caller's userMessage so the title isn't
  // generated from an empty string.
  it('falls back to the caller userMessage when the first-turn SELECT is empty', async () => {
    const { chat } = await import('../../src/shared/llm/chat.js');
    vi.mocked(chat).mockResolvedValue({ text: 'Fallback Title' } as never);

    const db = buildDb({
      existingTitle: null,
      turnsFirstUserMessage: null,
    });

    await generateSessionTitle(fakeConfig(), db as never, SESSION_ID, 'FALLBACK_TEXT');

    expect(vi.mocked(chat)).toHaveBeenCalledOnce();
    const args = vi.mocked(chat).mock.calls[0]!;
    const promptArg = args[1] as { messages: Array<{ role: string; content: string }> };
    expect(promptArg.messages).toEqual([{ role: 'user', content: 'FALLBACK_TEXT' }]);
  });
});
