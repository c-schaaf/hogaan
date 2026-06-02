import { jwtVerify } from 'jose';
import type { AppConfig } from '../shared/secrets/config.js';

/**
 * SCRUM (PR 6, launch-readiness D-5) — local Supabase JWT verification.
 *
 * Pre-fix, every `/api/*` request did a `supabase.auth.getUser(token)`
 * round-trip to validate the Bearer token. At ~80–150ms per request, that
 * was both a meaningful chunk of the TTFT budget and a single-point-of-
 * failure on Supabase Auth: if Supabase had a bad day, every backend
 * request to our app failed.
 *
 * We now verify the JWT locally against the Supabase project's JWT secret
 * (`SUPABASE_JWT_SECRET`). The signature, expiry, and issuer are checked
 * by `jose`. The `sub` claim gives us the Supabase user id, the `email`
 * claim gives the user's email — enough to look up our `public.users` row
 * for the common case of an already-onboarded user.
 *
 * Fallback: if the JWT secret isn't configured (dev / test without the
 * secret set), or if local verify fails for any structural reason, the
 * caller falls back to `supabase.auth.getUser` so we degrade rather than
 * break. The JIT-create path (first sign-in, where we need user_metadata
 * for full name) still uses `getUser` regardless.
 */

export interface LocalSupabaseClaims {
  /** Supabase auth user id (auth.users.id). */
  sub: string;
  email: string;
  /** ISO seconds since epoch — used as a sanity check by callers. */
  exp: number;
  /** user_metadata.full_name when available, otherwise undefined. */
  fullName?: string;
}

let cachedSecret: Uint8Array | undefined;

function getSecret(config: AppConfig): Uint8Array | undefined {
  if (cachedSecret !== undefined) return cachedSecret;
  const raw = config.supabaseJwtSecret;
  if (raw === undefined || raw.length === 0) return undefined;
  cachedSecret = new TextEncoder().encode(raw);
  return cachedSecret;
}

/**
 * Verify a Supabase access token locally. Returns the claims on success,
 * `null` on any verification failure (bad signature, expired, malformed,
 * unsupported algorithm, missing secret config). Caller should fall back
 * to `supabase.auth.getUser` on `null` so unverified tokens don't slip
 * through as a side-effect of misconfiguration.
 */
export async function verifySupabaseJwtLocal(
  config: AppConfig,
  token: string,
): Promise<LocalSupabaseClaims | null> {
  const secret = getSecret(config);
  if (secret === undefined) return null;
  const projectUrl = config.supabaseUrl;
  if (projectUrl === undefined || projectUrl.length === 0) return null;
  const issuer = `${projectUrl.replace(/\/$/, '')}/auth/v1`;

  try {
    const { payload } = await jwtVerify(token, secret, {
      // Supabase issues tokens signed HS256 by default. Pin the algorithm
      // to prevent a "none" downgrade attack.
      algorithms: ['HS256'],
      issuer,
      audience: 'authenticated',
    });
    const sub = typeof payload['sub'] === 'string' ? payload['sub'] : null;
    const email = typeof payload['email'] === 'string' ? payload['email'] : null;
    const exp = typeof payload['exp'] === 'number' ? payload['exp'] : null;
    if (sub === null || email === null || exp === null) return null;
    const userMetadata =
      typeof payload['user_metadata'] === 'object' && payload['user_metadata'] !== null
        ? (payload['user_metadata'] as Record<string, unknown>)
        : null;
    const fullName =
      userMetadata !== null && typeof userMetadata['full_name'] === 'string'
        ? userMetadata['full_name']
        : userMetadata !== null && typeof userMetadata['name'] === 'string'
          ? userMetadata['name']
          : undefined;
    return fullName === undefined
      ? { sub, email: email.toLowerCase(), exp }
      : { sub, email: email.toLowerCase(), exp, fullName };
  } catch {
    return null;
  }
}

/** Test-only seam to clear the cached secret between tests. */
export function resetSupabaseJwtCacheForTests(): void {
  cachedSecret = undefined;
}
