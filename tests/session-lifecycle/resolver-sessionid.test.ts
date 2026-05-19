import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSession } from '../../src/session-lifecycle/index.js';
import { asSessionId, asUserId } from '../../src/shared/types/index.js';

/**
 * SCRUM-53 — resolveSession honors a client-provided sessionId.
 *
 * These tests mock the Drizzle query chain instead of hitting Postgres, so
 * they stay in the unit layer (fastest catching layer per CLAUDE.md).
 * The integration test under tests/web-api/ covers the full route wiring.
 */

const USER = asUserId('00000000-0000-0000-0000-000000000001');
const OWNED_OPEN = 'sess-owned-open';
const OWNED_CLOSED = 'sess-owned-closed';
const FOREIGN = 'sess-foreign';

interface FakeRow {
  id: string;
  lastTurnAt: Date;
  turnCount: number;
  metadata: Record<string, unknown> | null;
  closedAt: Date | null;
}

function buildDb(opts: {
  /** Row to return for the `where(userId AND id)` named-session lookup. */
  namedLookup?: FakeRow;
  /** Captures the row that `update(sessions).set(...)` was called with. */
  updateSpy?: ReturnType<typeof vi.fn>;
  /** Inserted-session row that the no-sessionId path returns. */
  insertedRow?: FakeRow;
}) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(opts.namedLookup !== undefined ? [opts.namedLookup] : []),
        }),
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          opts.updateSpy?.(vals);
          return Promise.resolve([]);
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () =>
          Promise.resolve(
            opts.insertedRow !== undefined
              ? [
                  {
                    id: opts.insertedRow.id,
                    lastTurnAt: opts.insertedRow.lastTurnAt,
                    metadata: opts.insertedRow.metadata,
                  },
                ]
              : [
                  {
                    id: 'sess-new-generated',
                    lastTurnAt: new Date(),
                    metadata: null,
                  },
                ],
          ),
      }),
    }),
  } as never;
}

describe('resolveSession — SCRUM-53 client sessionId', () => {
  let updateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    updateSpy = vi.fn();
  });

  it('returns the named session when it is open and owned by the user', async () => {
    const db = buildDb({
      namedLookup: {
        id: OWNED_OPEN,
        lastTurnAt: new Date('2026-05-10T10:00:00Z'),
        turnCount: 4,
        metadata: { foo: 'bar' },
        closedAt: null,
      },
      updateSpy,
    });

    const result = await resolveSession(db, { userId: USER, sessionId: asSessionId(OWNED_OPEN) });

    expect(result.sessionId).toBe(OWNED_OPEN);
    expect(result.isNew).toBe(false);
    expect(result.turnCount).toBe(4);
    expect(result.metadata).toEqual({ foo: 'bar' });
    // Open session — no reopen UPDATE should have fired.
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('reopens a closed session owned by the user and returns it', async () => {
    const db = buildDb({
      namedLookup: {
        id: OWNED_CLOSED,
        lastTurnAt: new Date('2026-05-01T10:00:00Z'),
        turnCount: 7,
        metadata: null,
        closedAt: new Date('2026-05-01T11:00:00Z'),
      },
      updateSpy,
    });

    const result = await resolveSession(db, {
      userId: USER,
      sessionId: asSessionId(OWNED_CLOSED),
    });

    expect(result.sessionId).toBe(OWNED_CLOSED);
    expect(result.isNew).toBe(false);
    // Reopen: closedAt cleared.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith({ closedAt: null });
  });

  it('creates a new session silently when the sessionId is not owned by the user', async () => {
    // Named lookup returns [] (foreign sessionId). Resolver must not 404 or
    // leak existence — it falls through to the no-sessionId path, which now
    // always creates a new session (SCRUM-54).
    const db = buildDb({
      updateSpy,
      insertedRow: {
        id: 'sess-fresh-from-foreign',
        lastTurnAt: new Date(),
        turnCount: 0,
        metadata: null,
        closedAt: null,
      },
    });

    const result = await resolveSession(db, {
      userId: USER,
      sessionId: asSessionId(FOREIGN),
    });

    expect(result.isNew).toBe(true);
    expect(result.sessionId).toBe('sess-fresh-from-foreign');
    // No leak: caller cannot distinguish "foreign id" from "no id".
  });

  it('creates a new session when sessionId is fabricated', async () => {
    const db = buildDb({ updateSpy });

    const result = await resolveSession(db, {
      userId: USER,
      sessionId: asSessionId('sess-totally-made-up'),
    });

    expect(result.isNew).toBe(true);
    expect(result.sessionId).toBe('sess-new-generated');
  });

  it('always creates a new session when no sessionId is provided (SCRUM-54)', async () => {
    // Even if the user has a recent open session, the resolver must not
    // continue it when no sessionId is named. Homepage / "New Chat" path.
    const db = buildDb({
      updateSpy,
      insertedRow: {
        id: 'sess-fresh-no-sessionid',
        lastTurnAt: new Date(),
        turnCount: 0,
        metadata: null,
        closedAt: null,
      },
    });

    const result = await resolveSession(db, { userId: USER });

    expect(result.isNew).toBe(true);
    expect(result.sessionId).toBe('sess-fresh-no-sessionid');
    // No legacy SELECT, no close-stale UPDATE — only the INSERT runs.
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
