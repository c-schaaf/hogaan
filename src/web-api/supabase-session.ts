import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { reportP0, reportP2, setSentryUser } from '../incident-handling/index.js';
import type { Database } from '../shared/db/client.js';
import { auditLog } from '../shared/db/schema/audit-log.js';
import { users } from '../shared/db/schema/users.js';
import { type AppConfig, requireConfig } from '../shared/secrets/config.js';
import { verifySupabaseJwtLocal } from './local-jwt.js';

/**
 * Phase B-bis — Supabase Auth session validation for /api/* routes.
 *
 * Flow:
 *   1. Client signs in via supabase-js and gets an access token.
 *   2. Client sends `Authorization: Bearer <token>` on every /api/* call.
 *   3. This middleware calls supabase.auth.getUser(token) to validate.
 *   4. On first authed call we JIT-create the public.users row, keyed by
 *      `supabase_user_id`.
 *   5. Every authed request also writes one append-only audit_log row
 *      (CLAUDE.md hard rule #4 — fail-closed). If the audit insert
 *      throws, the request is rejected with 5xx; the route handler is
 *      never invoked.
 *
 * We deliberately use the REST validate path (getUser) instead of local
 * JWT verify so we don't have to grab SUPABASE_JWT_SECRET. Latency cost
 * is ~80-150ms per request — acceptable for v1.
 */

export interface WebSession {
  /** public.users.id (uuid). */
  userId: string;
  email: string;
  /** auth.users.id from Supabase. */
  supabaseUserId: string;
  /** Display name from Supabase user_metadata.full_name (or .name). Empty string when not present. */
  fullName: string;
}

let cachedClient: SupabaseClient | undefined;
function getSupabase(config: AppConfig): SupabaseClient {
  if (cachedClient !== undefined) return cachedClient;
  const url = requireConfig(config, 'supabaseUrl');
  const key = requireConfig(config, 'supabaseAnonKey');
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

export interface ReadSessionOpts {
  config: AppConfig;
  db: Database;
}

/**
 * Append a single audit_log row. Awaited by the middleware; if the insert
 * throws, the caller returns 5xx and the route handler is never reached.
 * Exported for the fail-closed-contract test.
 */
export async function writeSupabaseAuditEntry(
  db: Database,
  entry: {
    userId: string;
    requestId: string;
    targetEndEvent: string;
    ipAddress: string | null;
  },
): Promise<void> {
  await db.insert(auditLog).values({
    requestId: entry.requestId,
    triggerSource: 'web_session',
    userId: entry.userId,
    targetEndEvent: entry.targetEndEvent,
    ipAddress: entry.ipAddress,
  });
}

/**
 * Per-route audit event name. Each /api/* handler passes its own value so
 * audit_log captures route-level granularity instead of the legacy constant
 * E1_SupabaseSessionValidated. Unknown / unsupplied values fall back to the
 * legacy constant for backwards compatibility with older callers.
 */
export type AuditEvent =
  | 'E1_SupabaseSessionValidated'
  | 'E1_ChatTurnStream'
  | 'E1_SessionsList'
  | 'E1_SessionsSearch'
  | 'E1_SessionGet'
  | 'E1_SessionDelete'
  | 'E1_ProfileGet'
  | 'E1_ProfilePatch'
  | 'E1_ProfileDelete';

export async function readSupabaseSession(
  req: FastifyRequest,
  opts: ReadSessionOpts,
  targetEndEvent: AuditEvent = 'E1_SupabaseSessionValidated',
): Promise<WebSession | null> {
  const auth = req.headers.authorization;
  const hasAuthHeader = typeof auth === 'string' && auth.length > 0;
  const token =
    typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
      ? auth.slice(7).trim()
      : '';
  if (token === '') {
    req.log.warn(
      { hasAuthHeader, authHeaderPreview: hasAuthHeader ? auth.slice(0, 16) + '…' : null },
      'supabase-session: no bearer token on request',
    );
    return null;
  }

  // SCRUM (PR 6, launch-readiness D-5) — try local JWT verify first. For
  // an already-onboarded user this skips the ~80–150ms Supabase round-
  // trip entirely. If local verify fails (no secret configured, or any
  // verification error) OR if the user is unknown to `public.users` (so
  // we need user_metadata to JIT-create), we fall back to `getUser`.
  const localClaims = await verifySupabaseJwtLocal(opts.config, token);

  let supabaseUserId: string;
  let email: string;
  let fullName: string;

  // Fast path: local verify succeeded AND we already have a public.users
  // row for this Supabase identity. No Supabase round-trip needed.
  if (localClaims !== null) {
    const existingFast = await opts.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.supabaseUserId, localClaims.sub))
      .limit(1);
    if (existingFast[0] !== undefined) {
      const userId = existingFast[0].id;
      try {
        await writeSupabaseAuditEntry(opts.db, {
          userId,
          requestId: req.id,
          targetEndEvent,
          ipAddress: req.ip ?? null,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        reportP0(
          'supabase-session: audit_log insert failed — returning 5xx (hard rule #4)',
          {
            source: 'PhaseBbis.SupabaseSession.Audit',
            extra: { error: errMsg, requestId: req.id, supabaseUserId: localClaims.sub },
          },
          err,
        );
        throw err;
      }
      return {
        userId,
        email: existingFast[0].email ?? localClaims.email,
        supabaseUserId: localClaims.sub,
        fullName: localClaims.fullName ?? '',
      };
    }
  }

  // Slow path: either local verify failed, or we need user_metadata to
  // JIT-create. Hit Supabase `getUser` for full identity info.
  const supabase = getSupabase(opts.config);
  const { data, error } = await supabase.auth.getUser(token);
  if (error !== null || data.user === null) {
    req.log.warn(
      {
        supabaseUrl: opts.config.supabaseUrl,
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? null,
        errorStatus: (error as { status?: number } | null)?.status ?? null,
        tokenPreview: token.slice(0, 12) + '…',
        tokenLen: token.length,
      },
      'supabase-session: getUser rejected token',
    );
    return null;
  }

  supabaseUserId = data.user.id;
  email = (data.user.email ?? '').toLowerCase();
  const meta = data.user.user_metadata ?? {};
  fullName =
    typeof meta['full_name'] === 'string'
      ? meta['full_name']
      : typeof meta['name'] === 'string'
        ? meta['name']
        : '';

  // JIT lookup-or-create on public.users keyed by supabase_user_id.
  const existing = await opts.db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.supabaseUserId, supabaseUserId))
    .limit(1);

  let userId: string;
  if (existing[0] !== undefined) {
    userId = existing[0].id;
  } else {
    const newId = randomUUID();
    try {
      await opts.db.insert(users).values({
        id: newId,
        email,
        supabaseUserId,
        status: 'provisional',
      });
      userId = newId;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      req.log.error(
        { error: errMsg, supabaseUserId, email },
        'supabase-session: JIT insert into public.users failed',
      );
      reportP2('supabase-session: insert race', {
        source: 'PhaseBbis.SupabaseSession',
        extra: { error: errMsg },
      });

      // SCRUM (PR 6, launch-readiness D-6) — only legitimate retry path is
      // a concurrent JIT race on the same `supabase_user_id`. Refetch on
      // that condition and use the winner.
      //
      // The previous code also had a Case B that relinked an existing row
      // to a new supabase identity when an orphan email collided
      // (`users_email_unique`). That was a tenant-takeover vector: if user
      // A was deleted from Supabase Auth and user B later signed up with
      // the same email, B inherited A's `public.users` row (and all of
      // A's sessions / turns / profile). The relink branch is removed.
      // An orphan-email collision now hard-fails the JIT — operator must
      // clean up the orphan row (see `scripts/orphan-users-report.ts`)
      // before the new sign-in can proceed.
      const refetched = await opts.db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(eq(users.supabaseUserId, supabaseUserId))
        .limit(1);
      if (refetched[0] !== undefined) {
        userId = refetched[0].id;
      } else if (email !== '' && errMsg.includes('users_email_unique')) {
        // Orphan-email collision — refuse to relink. Surface a P0 so ops
        // can investigate and decide whether to remove the orphan.
        reportP0(
          'supabase-session: orphan-email collision on JIT (refusing to relink)',
          {
            source: 'PhaseBbis.SupabaseSession.OrphanEmail',
            extra: { supabaseUserId, email, requestId: req.id },
          },
          err,
        );
        req.log.error(
          { supabaseUserId, email },
          'supabase-session: orphan-email collision — refusing to relink, returning null',
        );
        return null;
      } else {
        req.log.error(
          { supabaseUserId },
          'supabase-session: refetch after insert-fail found nothing — returning null',
        );
        return null;
      }
    }
  }

  // Append-only audit row — CLAUDE.md hard rule #4 fail-closed. If this
  // throws, the middleware surfaces the error to the caller (5xx) and the
  // route handler is never invoked. Caller-visible request id flows through
  // for triage.
  try {
    await writeSupabaseAuditEntry(opts.db, {
      userId,
      requestId: req.id,
      targetEndEvent,
      ipAddress: req.ip ?? null,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    reportP0(
      'supabase-session: audit_log insert failed — returning 5xx (hard rule #4)',
      {
        source: 'PhaseBbis.SupabaseSession.Audit',
        extra: { error: errMsg, requestId: req.id, supabaseUserId },
      },
      err,
    );
    throw err;
  }

  // Attach internal user id to the Sentry scope so any incident reported
  // for the rest of this request includes the "user affected" field. Opaque
  // UUID only — never plaintext email or other PII (hard rule #3).
  setSentryUser(userId);

  return { userId, email, supabaseUserId, fullName };
}

export async function requireSupabaseSession(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: ReadSessionOpts,
  targetEndEvent: AuditEvent = 'E1_SupabaseSessionValidated',
): Promise<WebSession | null> {
  let session: WebSession | null;
  try {
    session = await readSupabaseSession(req, opts, targetEndEvent);
  } catch (err) {
    // Hard rule #4 — audit_log insert failure is fail-closed.
    req.log.error(
      { error: err instanceof Error ? err.message : String(err) },
      'supabase-session: hard failure',
    );
    void reply.code(500).send({ error: 'service_unavailable' });
    return null;
  }
  if (session === null) {
    void reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return session;
}
