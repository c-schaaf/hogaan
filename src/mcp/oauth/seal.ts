import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { now } from '../../shared/clock.js';

/**
 * Signed, self-contained values for "Sign in with Hogaan" (MCP OAuth).
 *
 * Each kind has its own prefix and its own signing key (derived from
 * MCP_OAUTH_SECRET with the kind as a label), so a value of one kind can
 * never be accepted as another: a refresh token is not an access token, a
 * registered client id is not a code.
 *
 * Why signed values instead of rows only: a hosted demo keeps its database
 * in memory and rebuilds it whenever the service sleeps. Anything that must
 * outlive that (a registered client, a refresh token) has to carry its own
 * proof. In the real app every grant is ALSO a database row, which is what
 * makes a connection revocable (see grants.ts); the signature alone is never
 * enough to use a revoked connection.
 *
 * The payload is readable by whoever holds the value (it is signed, not
 * encrypted). It carries opaque ids and the client's display name, nothing
 * about the leader.
 */
export type SealKind = 'client' | 'request' | 'code' | 'access' | 'refresh';

export const SEAL_PREFIX: Record<SealKind, string> = {
  client: 'hgc_', // a client registered by Dynamic Client Registration
  request: 'hgr_', // an authorization request waiting for the leader's consent
  code: 'hgk_', // an authorization code
  access: 'hgo_', // an access token (sent to /mcp)
  refresh: 'hgf_', // a refresh token
};

export const MIN_SECRET_LENGTH = 32;
const MAX_SEALED_LENGTH = 4096;

function keyFor(secret: string, kind: SealKind): Buffer {
  return createHmac('sha256', secret).update(`hogaan-mcp-oauth-v1:${kind}`).digest();
}

function mac(secret: string, kind: SealKind, body: string): string {
  return createHmac('sha256', keyFor(secret, kind)).update(body).digest('base64url');
}

export function seal(secret: string, kind: SealKind, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${SEAL_PREFIX[kind]}${body}.${mac(secret, kind, body)}`;
}

/**
 * Verify and decode. Returns null for a wrong prefix, a bad signature,
 * malformed JSON, or a payload whose numeric `exp` (seconds) has passed.
 */
export function unseal<T extends Record<string, unknown>>(
  secret: string,
  kind: SealKind,
  value: unknown,
): T | null {
  if (typeof value !== 'string' || value.length > MAX_SEALED_LENGTH) return null;
  const prefix = SEAL_PREFIX[kind];
  if (!value.startsWith(prefix)) return null;
  const rest = value.slice(prefix.length);
  const dot = rest.indexOf('.');
  if (dot <= 0 || dot !== rest.lastIndexOf('.')) return null;
  const body = rest.slice(0, dot);
  const sig = Buffer.from(rest.slice(dot + 1));
  const expected = Buffer.from(mac(secret, kind, body));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const exp = (payload as { exp?: unknown }).exp;
  if (exp !== undefined && (typeof exp !== 'number' || exp <= nowSeconds())) return null;
  return payload as T;
}

export function nowSeconds(): number {
  return Math.floor(now().getTime() / 1000);
}

export function newJti(): string {
  return randomBytes(16).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** PKCE S256: BASE64URL(SHA256(verifier)) === challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  // RFC 7636 §4.1: 43–128 characters from the unreserved set.
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const given = Buffer.from(challenge);
  return computed.length === given.length && timingSafeEqual(computed, given);
}
