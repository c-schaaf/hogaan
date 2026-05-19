import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readSupabaseSession,
  writeSupabaseAuditEntry,
} from '../../src/web-api/supabase-session.js';
import { fakeConfig } from '../phase-10/helpers/fakes.js';

/**
 * Hard Rule #4 — audit-log writes are fail-closed.
 *
 * The audit-log writer moved from the deleted src/identity/audit.ts to
 * src/web-api/supabase-session.ts in the launch-cleanup batch. Every
 * authenticated request appends one row; if the INSERT throws,
 * `readSupabaseSession` re-throws and the middleware translates that to
 * a 5xx — the route handler is never reached.
 */

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: {
            user: {
              id: '11111111-1111-1111-1111-111111111111',
              email: 'test@hogaan.test',
              user_metadata: { full_name: 'Test User' },
            },
          },
          error: null,
        }),
    },
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

interface FakeDbOpts {
  /** When set, the audit_log insert throws this error. */
  auditInsertError?: Error;
}

function fakeDb(opts: FakeDbOpts = {}) {
  // Returns one existing user so the JIT-insert path is skipped — the
  // only INSERT exercised is the audit-log row.
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () =>
      Promise.resolve([{ id: '22222222-2222-2222-2222-222222222222', email: 'test@hogaan.test' }]),
  };

  const insertCalls: unknown[] = [];
  const db = {
    select: () => selectChain,
    insert: () => ({
      values: (vals: unknown) => {
        insertCalls.push(vals);
        if (opts.auditInsertError !== undefined) {
          return Promise.reject(opts.auditInsertError);
        }
        return Promise.resolve(undefined);
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  };
  return { db, insertCalls };
}

function fakeReq(overrides: Record<string, unknown> = {}) {
  return {
    headers: { authorization: 'Bearer fake-token' },
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    id: 'req-fail-closed-001',
    ip: '127.0.0.1',
    ...overrides,
  } as never;
}

describe('supabase-session — Hard Rule #4 audit-log fail-closed', () => {
  it('rethrows when the audit_log INSERT rejects', async () => {
    const auditError = new Error('connection terminated unexpectedly');
    const { db } = fakeDb({ auditInsertError: auditError });

    await expect(
      readSupabaseSession(fakeReq(), {
        config: fakeConfig({ supabaseUrl: 'http://test', supabaseAnonKey: 'test-key' }),
        db: db as never,
      }),
    ).rejects.toBe(auditError);
  });

  it('returns a session on the happy path (audit_log INSERT resolves)', async () => {
    const { db, insertCalls } = fakeDb();

    const session = await readSupabaseSession(fakeReq({ id: 'req-happy-001' }), {
      config: fakeConfig({ supabaseUrl: 'http://test', supabaseAnonKey: 'test-key' }),
      db: db as never,
    });
    expect(session).not.toBeNull();
    expect(session?.userId).toBe('22222222-2222-2222-2222-222222222222');
    expect(session?.fullName).toBe('Test User');
    // Exactly one INSERT — the audit row.
    expect(insertCalls).toHaveLength(1);
  });

  it('writeSupabaseAuditEntry forwards every field to db.insert(...).values(...)', async () => {
    const { db, insertCalls } = fakeDb();

    await writeSupabaseAuditEntry(db as never, {
      userId: '33333333-3333-3333-3333-333333333333',
      requestId: 'req-direct-001',
      targetEndEvent: 'E1_SupabaseSessionValidated',
      ipAddress: '10.0.0.1',
    });

    expect(insertCalls).toHaveLength(1);
    const row = insertCalls[0] as Record<string, unknown>;
    expect(row['userId']).toBe('33333333-3333-3333-3333-333333333333');
    expect(row['requestId']).toBe('req-direct-001');
    expect(row['targetEndEvent']).toBe('E1_SupabaseSessionValidated');
    expect(row['triggerSource']).toBe('web_session');
    expect(row['ipAddress']).toBe('10.0.0.1');
  });
});
