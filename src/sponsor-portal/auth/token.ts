import { randomUUID } from 'node:crypto';
import {
  issueSessionToken,
  TokenInvalidError,
  TokenServiceUnavailableError,
  validateSessionToken,
} from '../../identity/token.js';
import type { RedisBundle } from '../../shared/redis/client.js';
import { type AppConfig } from '../../shared/secrets/config.js';
import { asUserId } from '../../shared/types/index.js';

/**
 * Phase 9A.1 — sponsor portal token wrapper.
 *
 * Reuses src/identity/token.ts (same JWT secret, same Redis revocation set)
 * but layers a `kind` claim so end-user session tokens can never be
 * smuggled into sponsor portal endpoints (and vice versa).
 *
 * Two token kinds:
 *   - `sponsor_magic_link` — single-use, ~10 min TTL. Issued when a
 *     sponsor user requests a login link; verified at the callback to
 *     issue a session token.
 *   - `sponsor_session` — ~24h TTL. Carries role + sponsorId in claims so
 *     handlers can RBAC without an extra DB read on every request.
 *
 * The kind discriminator is enforced in the validate functions — a token
 * with the wrong kind throws TokenInvalidError ("kind mismatch") and is
 * indistinguishable from any other invalid-token failure.
 */

export type SponsorRole = 'sponsor_admin' | 'hogaan_ops';

const MAGIC_LINK_TTL_S = 600; // 10 min
const SESSION_TTL_S = 24 * 60 * 60; // 24 h

export interface MagicLinkClaims {
  sponsorUserId: string;
  /** Email at the time of request — bound into the token so a stolen link
   * can't authenticate a different account. */
  email: string;
}

export interface SponsorSessionClaims {
  sponsorUserId: string;
  role: SponsorRole;
  /** Null for hogaan_ops who aren't bound to a single sponsor. */
  sponsorId: string | null;
  email: string;
}

export async function issueMagicLinkToken(
  config: AppConfig,
  claims: MagicLinkClaims,
): Promise<string> {
  return issueSessionToken(config, {
    userId: asUserId(claims.sponsorUserId),
    jti: `mlnk-${randomUUID()}`,
    ttlSeconds: MAGIC_LINK_TTL_S,
    extraClaims: {
      kind: 'sponsor_magic_link',
      email: claims.email,
    },
  });
}

export async function validateMagicLinkToken(
  config: AppConfig,
  redis: RedisBundle,
  token: string,
): Promise<MagicLinkClaims & { jti: string }> {
  const validated = await validateSessionToken(config, redis, token);
  // Decode-payload check: the kind+email aren't first-class on ValidatedToken.
  // Re-decode (already validated by validateSessionToken so we trust the body).
  const payload = decodePayloadUnsafe(token);
  if (payload['kind'] !== 'sponsor_magic_link') {
    throw new TokenInvalidError('token kind is not sponsor_magic_link');
  }
  const email = payload['email'];
  if (typeof email !== 'string' || email.length === 0) {
    throw new TokenInvalidError('magic-link token missing email');
  }
  return {
    sponsorUserId: validated.userId as unknown as string,
    email,
    jti: validated.jti,
  };
}

export async function issueSponsorSessionToken(
  config: AppConfig,
  claims: SponsorSessionClaims,
): Promise<string> {
  return issueSessionToken(config, {
    userId: asUserId(claims.sponsorUserId),
    jti: `sess-${randomUUID()}`,
    ttlSeconds: SESSION_TTL_S,
    extraClaims: {
      kind: 'sponsor_session',
      role: claims.role,
      sponsorId: claims.sponsorId ?? '',
      email: claims.email,
    },
  });
}

export async function validateSponsorSessionToken(
  config: AppConfig,
  redis: RedisBundle,
  token: string,
): Promise<SponsorSessionClaims & { jti: string; exp: number }> {
  const validated = await validateSessionToken(config, redis, token);
  const payload = decodePayloadUnsafe(token);
  if (payload['kind'] !== 'sponsor_session') {
    throw new TokenInvalidError('token kind is not sponsor_session');
  }
  const role = payload['role'];
  if (role !== 'sponsor_admin' && role !== 'hogaan_ops') {
    throw new TokenInvalidError(`invalid role on token: ${String(role)}`);
  }
  const email = payload['email'];
  if (typeof email !== 'string' || email.length === 0) {
    throw new TokenInvalidError('session token missing email');
  }
  const rawSponsorId = payload['sponsorId'];
  const sponsorIdRaw = typeof rawSponsorId === 'string' ? rawSponsorId : '';
  return {
    sponsorUserId: validated.userId as unknown as string,
    role,
    sponsorId: sponsorIdRaw === '' ? null : sponsorIdRaw,
    email,
    jti: validated.jti,
    exp: validated.exp,
  };
}

/**
 * Read the JWT body without re-verifying signature. ONLY safe to call after
 * `validateSessionToken` has already returned successfully — in which case
 * the signature + expiry have already been enforced.
 */
function decodePayloadUnsafe(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new TokenInvalidError('malformed jwt');
  }
  try {
    const json = Buffer.from(parts[1]!, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return parsed;
  } catch (err) {
    throw new TokenInvalidError(`jwt body decode failed: ${(err as Error).message}`);
  }
}

export { TokenInvalidError, TokenServiceUnavailableError };
