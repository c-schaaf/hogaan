import { createHash, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { reportP2 } from '../incident-handling/index.js';
import type { Database } from '../shared/db/client.js';
import { users } from '../shared/db/schema/users.js';
import { type AppConfig, requireConfig } from '../shared/secrets/config.js';

/**
 * Phase B-bis - Supabase Auth session validation for /api/* routes.
 *
 * Replaces the custom magic-link middleware. Flow:
 *
 *   1. Client (web/src/lib/supabase.ts) signs in via supabase-js and gets
 *      an access token in localStorage.
 *   2. Client sends `Authorization: Bearer <token>` on every /api/* call.
 *   3. This middleware calls supabase.auth.getUser(token) to validate.
 *   4. On first authed call we JIT-create the public.users row, keyed by
 *      `supabase_user_id`. WhatsApp users' rows are untouched.
 *
 * We deliberately use the REST validate path (getUser) instead of local
 * JWT verify so we don't have to grab SUPABASE_JWT_SECRET from the
 * dashboard. Latency cost is ~80-150ms per request - acceptable for v1.
 * Switch to local jose.jwtVerify later if it bites.
 */

export interface WebSession {
  /** public.users.id (uuid). */
  userId: string;
  email: string;
  /** auth.users.id from Supabase. */
  supabaseUserId: string;
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

export async function readSupabaseSession(
  req: FastifyRequest,
  opts: ReadSessionOpts,
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

  const supabaseUserId = data.user.id;
  const email = (data.user.email ?? '').toLowerCase();

  // JIT lookup-or-create on public.users keyed by supabase_user_id.
  const existing = await opts.db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.supabaseUserId, supabaseUserId))
    .limit(1);

  if (existing[0] !== undefined) {
    return { userId: existing[0].id, email: existing[0].email ?? email, supabaseUserId };
  }

  // Provision a row. Pull display name from Supabase user_metadata when present.
  const meta = data.user.user_metadata ?? {};
  const fullName =
    typeof meta['full_name'] === 'string'
      ? meta['full_name']
      : typeof meta['name'] === 'string'
        ? meta['name']
        : '';

  const userId = randomUUID();
  const phoneHash = createHash('sha256').update(`web:${userId}`).digest('hex');

  try {
    await opts.db.insert(users).values({
      id: userId,
      phoneHash,
      email,
      supabaseUserId,
      status: 'provisional',
      profileFlags: fullName !== '' ? { fullName } : {},
    });
  } catch (err) {
    // Race / unique-violation: another concurrent request may have inserted.
    // Re-read and return.
    const errMsg = err instanceof Error ? err.message : String(err);
    req.log.error(
      { error: errMsg, supabaseUserId, email },
      'supabase-session: JIT insert into public.users failed',
    );
    reportP2('supabase-session: insert race', {
      source: 'PhaseBbis.SupabaseSession',
      extra: { error: errMsg },
    });
    const refetched = await opts.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.supabaseUserId, supabaseUserId))
      .limit(1);
    if (refetched[0] !== undefined) {
      return { userId: refetched[0].id, email: refetched[0].email ?? email, supabaseUserId };
    }
    req.log.error(
      { supabaseUserId },
      'supabase-session: refetch after insert-fail found nothing — returning null',
    );
    return null;
  }
  return { userId, email, supabaseUserId };
}

export async function requireSupabaseSession(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: ReadSessionOpts,
): Promise<WebSession | null> {
  const session = await readSupabaseSession(req, opts);
  if (session === null) {
    void reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return session;
}
