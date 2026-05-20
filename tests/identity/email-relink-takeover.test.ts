import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { users } from '../../src/shared/db/schema/users.js';
import { readSupabaseSession } from '../../src/web-api/supabase-session.js';
import { fakeConfig } from '../phase-10/helpers/fakes.js';

/**
 * SCRUM (PR 6, launch-readiness D-6 / audit MT-2) — the email-relink branch
 * in `readSupabaseSession` was a tenant-takeover vector: if user A was
 * deleted from Supabase Auth and user B later signed up with the same
 * email, the relink would hand A's `public.users` row (and all of A's
 * sessions / turns / profile data) to B. This test asserts the relink no
 * longer happens — an orphan-email collision now hard-fails the JIT
 * (returns null + emits a P0) and the orphan row is left untouched for
 * operator cleanup.
 */

const ORPHAN_USER_ID = '00000000-0000-0000-0000-000000000aaa';
const ORPHAN_SUPABASE_USER_ID = '00000000-0000-0000-0000-deletedaaaaa';
const ORPHAN_EMAIL = 'shared@example.com';
const NEW_SUPABASE_USER_ID = '00000000-0000-0000-0000-newffffffff';

interface Stored {
  users: Array<{ id: string; supabaseUserId: string | null; email: string | null }>;
}

function makeFakeDb(initial: Stored) {
  const state: Stored = JSON.parse(JSON.stringify(initial)) as Stored;
  return {
    state,
    db: {
      select: () => ({
        from: () => ({
          where: (whereExpr: unknown) => ({
            limit: () => {
              // Crude condition matcher: drizzle's where() returns an SQL
              // expression we don't introspect — we just peek at the call
              // order. The relink branch first hits `where(eq(users.supabaseUserId, ...))`
              // and then `where(eq(users.email, ...))`. We dispatch by a
              // sequence counter.
              void whereExpr;
              return Promise.resolve([]);
            },
          }),
        }),
      }),
      insert: () => ({
        values: (vals: Record<string, unknown>) => {
          // The fake insert always fails with the email-unique violation
          // when the email matches an orphan row, so we can drive the
          // relink branch under test.
          if (vals['email'] === ORPHAN_EMAIL) {
            return Promise.reject(
              new Error('duplicate key value violates unique constraint "users_email_unique"'),
            );
          }
          return Promise.resolve([]);
        },
      }),
      update: vi.fn(() => ({
        set: () => ({
          where: () => Promise.resolve([]),
        }),
      })),
      delete: () => ({ where: () => Promise.resolve([]) }),
    },
  };
}

// The handler uses two `select(...).from(users).where(...)` calls in the
// JIT-failure branch: (1) refetch by supabaseUserId, (2) lookup by email.
// We need a richer fake to drive them. Build one with stateful query
// dispatch tied to the order of where() calls.
function makeStatefulDb() {
  let whereCalls = 0;
  const updateSpy = vi.fn(() => ({
    set: () => ({ where: () => Promise.resolve([]) }),
  }));
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          whereCalls += 1;
          if (whereCalls === 1) {
            // First call: lookup by supabaseUserId for the NEW identity → empty.
            return { limit: () => Promise.resolve([]) };
          }
          if (whereCalls === 2) {
            // Second call (after JIT insert fails): refetch by supabaseUserId → empty.
            return { limit: () => Promise.resolve([]) };
          }
          // Third call (pre-fix): lookup by email → would return the orphan.
          // The new code doesn't make this call.
          return {
            limit: () =>
              Promise.resolve([
                {
                  id: ORPHAN_USER_ID,
                  email: ORPHAN_EMAIL,
                  supabaseUserId: ORPHAN_SUPABASE_USER_ID,
                },
              ]),
          };
        },
      }),
    }),
    insert: () => ({
      values: () =>
        Promise.reject(
          new Error('duplicate key value violates unique constraint "users_email_unique"'),
        ),
    }),
    update: updateSpy,
    delete: () => ({ where: () => Promise.resolve([]) }),
  };
  return { db, updateSpy, getWhereCalls: () => whereCalls };
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: {
            user: {
              id: NEW_SUPABASE_USER_ID,
              email: ORPHAN_EMAIL,
              user_metadata: { full_name: 'Bob (new user)' },
            },
          },
          error: null,
        }),
    },
  }),
}));

describe('supabase-session.readSupabaseSession — MT-2 email-relink takeover', () => {
  let _stored: ReturnType<typeof makeFakeDb>;
  beforeEach(() => {
    vi.clearAllMocks();
    _stored = makeFakeDb({
      users: [
        {
          id: ORPHAN_USER_ID,
          supabaseUserId: ORPHAN_SUPABASE_USER_ID,
          email: ORPHAN_EMAIL,
        },
      ],
    });
    void _stored;
  });

  it('refuses to relink an orphan row to a new Supabase identity (returns null)', async () => {
    const { db, updateSpy } = makeStatefulDb();
    const cfg = fakeConfig({
      supabaseUrl: 'http://supabase.test',
      supabaseAnonKey: 'anon',
      supabaseJwtSecret: undefined, // force the slow path through getUser
    });
    const req = {
      headers: { authorization: 'Bearer fake-bearer-token' },
      log: { warn: vi.fn(), error: vi.fn() },
      id: 'req-takeover-1',
      ip: '127.0.0.1',
    };

    const result = await readSupabaseSession(
      req as never,
      { config: cfg, db: db as never },
      'E1_ProfileGet',
    );

    // The takeover attempt is refused — null return forces a 401 upstream.
    expect(result).toBeNull();
    // Critically: the orphan row was NOT updated to take the new supabase id.
    expect(updateSpy).not.toHaveBeenCalled();
    void eq;
    void users;
  });
});
