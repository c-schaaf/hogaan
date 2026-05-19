import { errors as joseErrors, jwtVerify, SignJWT } from 'jose';
import type { RedisBundle } from '../shared/redis/client.js';
import { type AppConfig, requireConfig } from '../shared/secrets/config.js';
import { asUserId, type UserId } from '../shared/types/index.js';

const REVOCATION_SET_KEY = 'token:revoked';

export class TokenInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenInvalidError';
  }
}

export class TokenServiceUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'TokenServiceUnavailableError';
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export interface ValidatedToken {
  userId: UserId;
  /** JWT id; tracked in the revocation set on logout. */
  jti: string;
  /** Seconds since epoch when the token expires. */
  exp: number;
}

let cachedKey: Uint8Array | undefined;

function getKey(config: AppConfig): Uint8Array {
  if (cachedKey === undefined) {
    const b64 = requireConfig(config, 'jwtSecretBase64');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 32) {
      throw new TokenServiceUnavailableError(
        `JWT_SECRET_BASE64 must decode to ≥32 bytes, got ${buf.length}`,
      );
    }
    cachedKey = new Uint8Array(buf);
  }
  return cachedKey;
}

/**
 * Process #12 Step 7. Validates a JWT (HS256), checks the revocation set in
 * Redis, returns the userId on success.
 *
 * Failure modes:
 *   - Token signature/structure/expiration → TokenInvalidError → orchestrator E9
 *   - Revoked → TokenInvalidError → E9
 *   - Redis or signing-key unavailable → TokenServiceUnavailableError → E10
 */
export async function validateSessionToken(
  config: AppConfig,
  redis: RedisBundle,
  token: string,
): Promise<ValidatedToken> {
  let secret: Uint8Array;
  try {
    secret = getKey(config);
  } catch (err) {
    throw new TokenServiceUnavailableError(
      'jwt secret unavailable',
      err instanceof Error ? err : new Error(String(err)),
    );
  }

  let payload;
  try {
    const result = await jwtVerify(token, secret, {
      ...(config.jwtIssuer !== undefined ? { issuer: config.jwtIssuer } : {}),
      ...(config.jwtAudience !== undefined ? { audience: config.jwtAudience } : {}),
    });
    payload = result.payload;
  } catch (err) {
    if (
      err instanceof joseErrors.JWTExpired ||
      err instanceof joseErrors.JWTInvalid ||
      err instanceof joseErrors.JWSInvalid ||
      err instanceof joseErrors.JWSSignatureVerificationFailed ||
      err instanceof joseErrors.JWTClaimValidationFailed
    ) {
      throw new TokenInvalidError(`token invalid: ${err.message}`);
    }
    throw new TokenInvalidError(`token verify failed: ${(err as Error).message}`);
  }

  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    throw new TokenInvalidError('token missing sub claim');
  }
  if (typeof payload.jti !== 'string' || payload.jti.length === 0) {
    throw new TokenInvalidError('token missing jti claim');
  }
  if (typeof payload.exp !== 'number') {
    throw new TokenInvalidError('token missing exp claim');
  }

  let isRevoked: number | null;
  try {
    isRevoked = await redis.withTimeout('token:revoked', 1500, () =>
      redis.client.sismember(REVOCATION_SET_KEY, payload.jti as string),
    );
  } catch (err) {
    throw new TokenServiceUnavailableError('revocation list unavailable', err);
  }

  if (isRevoked === 1) {
    throw new TokenInvalidError('token revoked');
  }

  return { userId: asUserId(payload.sub), jti: payload.jti, exp: payload.exp };
}

/**
 * Issuer used by legacy magic-link tokens. Lives in the identity
 * module so the issue/verify pair stays in one place.
 */
export interface IssueOptions {
  userId: UserId;
  jti: string;
  /** Lifetime in seconds. Magic links should be short-lived (e.g. 600s). */
  ttlSeconds: number;
  extraClaims?: Record<string, string | number | boolean>;
}

export async function issueSessionToken(config: AppConfig, opts: IssueOptions): Promise<string> {
  const secret = getKey(config);
  const now = Math.floor(Date.now() / 1000);
  let jwt = new SignJWT(opts.extraClaims ?? {})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(opts.userId)
    .setJti(opts.jti)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + opts.ttlSeconds);
  if (config.jwtIssuer !== undefined) {
    jwt = jwt.setIssuer(config.jwtIssuer);
  }
  if (config.jwtAudience !== undefined) {
    jwt = jwt.setAudience(config.jwtAudience);
  }
  return jwt.sign(secret);
}

export async function revokeToken(redis: RedisBundle, jti: string): Promise<void> {
  await redis.withTimeout('token:revoke', 500, () => redis.client.sadd(REVOCATION_SET_KEY, jti));
}

/** Test/teardown only. */
export function resetTokenCacheForTests(): void {
  cachedKey = undefined;
}
