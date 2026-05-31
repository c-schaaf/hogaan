import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSupabaseSession } from '../../src/web-api/supabase-session.js';
import { fakeConfig } from '../phase-10/helpers/fakes.js';

/**
 * SCRUM-F5: Hard Rule #3 (PII discipline) — plaintext email addresses must
 * never reach Pino log lines or Sentry `extra` payloads. Pre-fix, three
 * sites in `supabase-session.ts` (JIT race log, orphan-email Sentry P0,
 * orphan-email refusal log) all included `email` as a plaintext field;
 * Pino's REDACT_PATHS scrubbed phone numbers but not emails, and Sentry's
 * beforeSend filter scrubbed phone numbers but not emails. So whenever
 * the JIT-race or orphan-email path fired, the user's plaintext email
 * landed in Render stdout logs and Sentry's searchable index.
 *
 * This test forces the orphan-email collision path to fire with a known
 * email, captures everything the code sends to `req.log.error` and to the
 * Sentry incident reporter, and asserts the plaintext email NEVER
 * appears in any captured payload — only its 16-char sha256 prefix does.
 */

const SECRET_EMAIL = 'private.tester@example.com';
const NEW_SUPABASE_USER_ID = '00000000-0000-0000-0000-newffffffff';

// Capture every call to the incident reporters so we can string-search the
// full payload for the secret email.
const reportP0Spy = vi.fn();
const reportP2Spy = vi.fn();
const setSentryUserSpy = vi.fn();
vi.mock('../../src/incident-handling/index.js', () => ({
  reportP0: (...args: unknown[]): void => {
    reportP0Spy(...args);
  },
  reportP2: (...args: unknown[]): void => {
    reportP2Spy(...args);
  },
  setSentryUser: (...args: unknown[]): void => {
    setSentryUserSpy(...args);
  },
}));

// Supabase getUser returns the secret email. The fake DB always rejects
// the JIT insert with the email-unique violation, driving the orphan
// collision branch.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: () =>
        Promise.resolve({
          data: {
            user: {
              id: NEW_SUPABASE_USER_ID,
              email: SECRET_EMAIL,
              user_metadata: { full_name: 'Tester' },
            },
          },
          error: null,
        }),
    },
  }),
}));

function makeOrphanCollisionDb() {
  let whereCalls = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => {
          whereCalls += 1;
          // Both lookups (supabaseUserId pre-insert + supabaseUserId refetch
          // post-insert-fail) return empty so the orphan-email branch fires.
          return { limit: () => Promise.resolve([]) };
        },
      }),
    }),
    insert: () => ({
      values: () =>
        Promise.reject(
          new Error('duplicate key value violates unique constraint "users_email_unique"'),
        ),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    _whereCalls: () => whereCalls,
  };
}

describe('supabase-session — F5 PII discipline (no plaintext email in logs / Sentry)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('never includes the plaintext email in Pino log calls or Sentry extras when the orphan-email path fires', async () => {
    const logErrorSpy = vi.fn();
    const logWarnSpy = vi.fn();
    const cfg = fakeConfig({
      supabaseUrl: 'http://supabase.test',
      supabaseAnonKey: 'anon',
      supabaseJwtSecret: undefined, // force the slow getUser path
    });
    const db = makeOrphanCollisionDb();
    const req = {
      headers: { authorization: 'Bearer fake-bearer-token' },
      log: { warn: logWarnSpy, error: logErrorSpy },
      id: 'req-f5-1',
      ip: '127.0.0.1',
    };

    const result = await readSupabaseSession(
      req as never,
      { config: cfg, db: db as never },
      'E1_ProfileGet',
    );

    // Behaviour preserved: orphan collision is still refused.
    expect(result).toBeNull();

    // Capture every payload the code emitted.
    const allLogPayloads = [
      ...logErrorSpy.mock.calls.map((c) => JSON.stringify(c)),
      ...logWarnSpy.mock.calls.map((c) => JSON.stringify(c)),
    ];
    const allIncidentPayloads = [
      ...reportP0Spy.mock.calls.map((c) => JSON.stringify(c)),
      ...reportP2Spy.mock.calls.map((c) => JSON.stringify(c)),
    ];
    const allCaptured = [...allLogPayloads, ...allIncidentPayloads];

    // Hard assertion: the plaintext email must not appear anywhere.
    for (const payload of allCaptured) {
      expect(payload).not.toContain(SECRET_EMAIL);
      expect(payload).not.toContain('private.tester');
    }

    // Sanity check: the orphan path actually fired (otherwise the test would
    // pass trivially by emitting nothing). At least one log call AND at
    // least one P0 should have been captured.
    expect(logErrorSpy.mock.calls.length).toBeGreaterThan(0);
    expect(reportP0Spy.mock.calls.length).toBeGreaterThan(0);

    // The hashed email MUST appear instead — same email always produces the
    // same 16-char hex prefix, and we want to be able to correlate incidents.
    const combined = allCaptured.join('|');
    expect(combined).toMatch(/[a-f0-9]{16}/);
  });

  it('hashes the email consistently across all three leak sites (one fingerprint per user)', async () => {
    const logErrorSpy = vi.fn();
    const cfg = fakeConfig({
      supabaseUrl: 'http://supabase.test',
      supabaseAnonKey: 'anon',
      supabaseJwtSecret: undefined,
    });
    const db = makeOrphanCollisionDb();
    const req = {
      headers: { authorization: 'Bearer fake-bearer-token' },
      log: { warn: vi.fn(), error: logErrorSpy },
      id: 'req-f5-2',
      ip: '127.0.0.1',
    };

    await readSupabaseSession(req as never, { config: cfg, db: db as never }, 'E1_ProfileGet');

    // Pull every emailHash value out of every captured payload — they must
    // all be the same 16-char prefix (deterministic hash → one user = one
    // fingerprint across logs and Sentry).
    const allCaptured = [
      ...logErrorSpy.mock.calls.map((c) => JSON.stringify(c)),
      ...reportP0Spy.mock.calls.map((c) => JSON.stringify(c)),
    ].join('|');
    const hashes = Array.from(allCaptured.matchAll(/"emailHash":"([a-f0-9]{16})"/g)).map(
      (m) => m[1],
    );

    expect(hashes.length).toBeGreaterThan(0);
    const distinct = new Set(hashes);
    expect(distinct.size).toBe(1);
  });
});
