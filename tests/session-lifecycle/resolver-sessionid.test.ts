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
  /** Row to return for the legacy `where(userId AND closedAt IS NULL)` lookup. */
  legacyLookup?: FakeRow;
  /** Captures the row that `update(sessions).set(...)` was called with. */
  updateSpy?: ReturnType<typeof vi.fn>;
  /** Inserted-session row that the legacy fall-through path returns. */
  insertedRow?: FakeRow;
}) {
  // Each .select() call returns a fresh chain; we use call-count to switch
  // between the named-lookup and the legacy-lookup branches.
  let selectCalls = 0;
  return {
    select: () => {
      selectCalls += 1;
      const callIdx = selectCalls;
      return {
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve(
                callIdx === 1 && opts.namedLookup !== undefined
                  ? [opts.namedLookup]
                  : callIdx === 1
                    ? []
                    : opts.legacyLookup !== undefined
                      ? [opts.legacyLookup]
                      : [],
              ),
            orderBy: () => ({
              limit: () =>
                Promise.resolve(opts.legacyLookup !== undefined ? [opts.legacyLookup] : []),
            }),
          }),
        }),
      };
    },
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

  it('falls through to legacy logic when the sessionId is not owned by the user', async () => {
    // First select (named lookup) returns []; second select (legacy lookup)
    // returns an open recent session within the 30-min window — caller
    // continues that session, no new row created.
    const recentLegacy: FakeRow = {
      id: 'sess-legacy-open',
      lastTurnAt: new Date(),
      turnCount: 2,
      metadata: null,
      closedAt: null,
    };
    const db = buildDb({
      legacyLookup: recentLegacy,
      updateSpy,
    });

    const result = await resolveSession(db, {
      userId: USER,
      sessionId: asSessionId(FOREIGN),
    });

    expect(result.sessionId).toBe('sess-legacy-open');
    expect(result.isNew).toBe(false);
    // Did not 404 and did not leak the foreign session — silent fall-through.
  });

  it('falls through to legacy logic and creates a new session when sessionId is fabricated and no legacy session exists', async () => {
    const db = buildDb({ updateSpy });

    const result = await resolveSession(db, {
      userId: USER,
      sessionId: asSessionId('sess-totally-made-up'),
    });

    expect(result.isNew).toBe(true);
    expect(result.sessionId).toBe('sess-new-generated');
  });

  it('preserves legacy 30-min auto-split behavior when no sessionId is provided', async () => {
    const legacyOpen: FakeRow = {
      id: 'sess-legacy-stale',
      lastTurnAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago — past idle
      turnCount: 3,
      metadata: null,
      closedAt: null,
    };
    const db = buildDb({
      legacyLookup: legacyOpen,
      updateSpy,
      insertedRow: {
        id: 'sess-new-after-split',
        lastTurnAt: new Date(),
        turnCount: 0,
        metadata: null,
        closedAt: null,
      },
    });

    const result = await resolveSession(db, { userId: USER });

    // Stale session was closed (update fired with closedAt = lastTurnAt),
    // then a fresh row created.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]?.[0]).toHaveProperty('closedAt');
    expect(result.isNew).toBe(true);
    expect(result.sessionId).toBe('sess-new-after-split');
  });
});
