import { lookup } from 'node:dns';
import https from 'node:https';
import { isIP } from 'node:net';
import { nowSeconds, seal, unseal } from './seal.js';

/**
 * Who is asking to connect: the OAuth "client" (an AI assistant).
 *
 * Two ways a client identifies itself, both from the MCP authorization spec
 * and both used by Claude:
 *
 *  1. Client ID Metadata Document (CIMD) — the client_id is an https URL.
 *     We fetch it and read the client's name and allowed return addresses.
 *     Claude's default ("Use Claude's published identity").
 *  2. Dynamic Client Registration (RFC 7591) — the client POSTs its details
 *     to /oauth/register. We hand back a client_id that IS those details,
 *     signed (seal kind 'client'), so nothing needs to be stored and a
 *     registration survives a demo restart. Claude's fallback.
 *
 * Only public clients are supported (token_endpoint_auth_method "none"),
 * which is what both of Claude's automatic methods use. PKCE is mandatory.
 */
export interface ClientInfo {
  clientId: string;
  name: string;
  redirectUris: string[];
  kind: 'cimd' | 'dcr';
}

export class ClientMetadataError extends Error {}

const MAX_REDIRECT_URIS = 10;
const MAX_URI_LENGTH = 500;
const MAX_NAME_LENGTH = 100;

/** Plain text for display: no control characters, trimmed, capped. */
export function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const s = raw
    .replace(/\p{Cc}|\p{Cf}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length === 0 ? fallback : s.slice(0, MAX_NAME_LENGTH);
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * MCP spec: "All redirect URIs MUST be either localhost or use HTTPS."
 * No fragments, no embedded credentials.
 */
export function isAllowedRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > MAX_URI_LENGTH) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash !== '' || u.username !== '' || u.password !== '') return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname);
}

/**
 * Exact match, except that for loopback (http://localhost, 127.0.0.1, [::1])
 * the port is ignored: local clients such as Claude Code pick a free port
 * each time (RFC 8252 §7.3; Claude's connector docs ask for this).
 */
export function redirectMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  let a: URL;
  let b: URL;
  try {
    a = new URL(registered);
    b = new URL(requested);
  } catch {
    return false;
  }
  if (a.protocol !== 'http:' || b.protocol !== 'http:') return false;
  if (!LOOPBACK_HOSTS.has(a.hostname) || a.hostname !== b.hostname) return false;
  return a.pathname === b.pathname && a.search === b.search && b.hash === '';
}

export function redirectHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return 'unknown';
  }
}

export function isLoopbackRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- DCR

export interface RegistrationResponse {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: 'none';
}

/** RFC 7591 registration. Throws ClientMetadataError with a plain reason. */
export function registerClient(secret: string, body: unknown): RegistrationResponse {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ClientMetadataError('Registration must be a JSON object.');
  }
  const b = body as Record<string, unknown>;
  const uris = b['redirect_uris'];
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    throw new ClientMetadataError('redirect_uris must list 1 to 10 addresses.');
  }
  for (const u of uris) {
    if (!isAllowedRedirectUri(u)) {
      throw new ClientMetadataError('Each redirect_uri must use https, or http on localhost.');
    }
  }
  const method = b['token_endpoint_auth_method'];
  if (method !== undefined && method !== 'none') {
    throw new ClientMetadataError(
      'Only public clients are supported (token_endpoint_auth_method "none").',
    );
  }
  const grants = b['grant_types'];
  if (
    grants !== undefined &&
    (!Array.isArray(grants) ||
      grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token'))
  ) {
    throw new ClientMetadataError(
      'grant_types may only include authorization_code and refresh_token.',
    );
  }
  const responses = b['response_types'];
  if (
    responses !== undefined &&
    (!Array.isArray(responses) || responses.some((r) => r !== 'code'))
  ) {
    throw new ClientMetadataError('response_types may only include code.');
  }
  const redirectUris = [...new Set(uris as string[])];
  const name = cleanName(b['client_name'], `Assistant at ${redirectHost(redirectUris[0]!)}`);
  const iat = nowSeconds();
  const clientId = seal(secret, 'client', { n: name, r: redirectUris, iat });
  return {
    client_id: clientId,
    client_id_issued_at: iat,
    client_name: name,
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

// ---------------------------------------------------------------- CIMD

/** True when `clientId` has the shape of a Client ID Metadata Document URL. */
export function isCimdClientId(clientId: string): boolean {
  if (clientId.length > MAX_URI_LENGTH) return false;
  let u: URL;
  try {
    u = new URL(clientId);
  } catch {
    return false;
  }
  return (
    u.protocol === 'https:' &&
    u.pathname !== '/' &&
    u.hash === '' &&
    u.username === '' &&
    u.password === '' &&
    (u.port === '' || u.port === '443') &&
    isIP(u.hostname.replace(/^\[|\]$/g, '')) === 0
  );
}

/** Fetches a metadata document; returns the parsed JSON and a cache lifetime. */
export type CimdFetcher = (url: URL) => Promise<{ json: unknown; maxAgeSeconds: number | null }>;

const CIMD_TIMEOUT_MS = 5_000;
const CIMD_MAX_BYTES = 64 * 1024;
const CACHE_DEFAULT_S = 300;
const CACHE_MIN_S = 60;
const CACHE_MAX_S = 3600;
const CACHE_MAX_ENTRIES = 100;

/** Private, loopback, link-local, multicast and other non-public addresses. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicV4(address);
  if (family !== 6) return false;
  const a = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped !== null) return isPublicV4(mapped[1]!);
  if (a === '::' || a === '::1') return false;
  const first = parseInt(a.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link local
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (a.startsWith('64:ff9b:') || a.startsWith('2001:db8:') || a.startsWith('::')) return false;
  return true;
}

function isPublicV4(address: string): boolean {
  const [a, b] = address.split('.').map(Number) as [number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64/10 carrier NAT
  if (a === 169 && b === 254) return false; // link local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false; // 192.0.0/24 and 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51) return false;
  if (a === 203 && b === 0) return false;
  return true;
}

/**
 * The real fetcher. Guards against the server being used to reach private
 * addresses (SSRF): https on 443 only, the name is resolved first and EVERY
 * address must be public, and the connection is pinned to the checked
 * address (so a DNS answer cannot change between check and connect). No
 * redirects are followed. 5 second timeout, 64 KB limit.
 */
const defaultFetcher: CimdFetcher = (url) =>
  new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        timeout: CIMD_TIMEOUT_MS,
        headers: { Accept: 'application/json', 'User-Agent': 'Hogaan-OAuth/1' },
        lookup: (hostname, _opts, cb) => {
          lookup(hostname, { all: true }, (err, addresses) => {
            if (err !== null) return cb(err, '', 4);
            if (addresses.length === 0 || addresses.some((x) => !isPublicAddress(x.address))) {
              return cb(new Error('client metadata host is not a public address'), '', 4);
            }
            const first = addresses[0]!;
            // Node may ask for all addresses; answer in the shape it asked for.
            if ((_opts as { all?: boolean }).all === true) {
              (cb as unknown as (e: null, a: typeof addresses) => void)(null, addresses);
              return;
            }
            cb(null, first.address, first.family);
          });
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new ClientMetadataError(`client metadata answered ${res.statusCode ?? 0}`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > CIMD_MAX_BYTES) {
            req.destroy(new ClientMetadataError('client metadata too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          try {
            const cc = String(res.headers['cache-control'] ?? '');
            const m = /max-age=(\d+)/.exec(cc);
            resolve({
              json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
              maxAgeSeconds: /no-store|no-cache/.test(cc) ? 0 : m !== null ? Number(m[1]) : null,
            });
          } catch {
            reject(new ClientMetadataError('client metadata is not JSON'));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new ClientMetadataError('client metadata timed out')));
    req.on('error', reject);
  });

let fetcher: CimdFetcher = defaultFetcher;
const cache = new Map<string, { info: ClientInfo; until: number }>();

/** Tests only: serve metadata documents without the network. */
export function setCimdFetcherForTests(f: CimdFetcher | null): void {
  fetcher = f ?? defaultFetcher;
  cache.clear();
}

async function fetchCimd(clientId: string): Promise<ClientInfo> {
  const hit = cache.get(clientId);
  if (hit !== undefined && hit.until > Date.now()) return hit.info;
  const { json, maxAgeSeconds } = await fetcher(new URL(clientId));
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new ClientMetadataError('client metadata must be a JSON object');
  }
  const doc = json as Record<string, unknown>;
  // Spec: the document's client_id MUST match the URL exactly.
  if (doc['client_id'] !== clientId) {
    throw new ClientMetadataError('client metadata client_id does not match its address');
  }
  const uris = doc['redirect_uris'];
  if (
    !Array.isArray(uris) ||
    uris.length === 0 ||
    uris.length > MAX_REDIRECT_URIS ||
    !uris.every(isAllowedRedirectUri)
  ) {
    throw new ClientMetadataError('client metadata redirect_uris are missing or not allowed');
  }
  const method = doc['token_endpoint_auth_method'];
  if (method !== undefined && method !== 'none') {
    throw new ClientMetadataError('only public clients are supported');
  }
  const info: ClientInfo = {
    clientId,
    name: cleanName(doc['client_name'], new URL(clientId).host),
    redirectUris: uris,
    kind: 'cimd',
  };
  const ttl = Math.min(CACHE_MAX_S, Math.max(CACHE_MIN_S, maxAgeSeconds ?? CACHE_DEFAULT_S));
  if (maxAgeSeconds !== 0) {
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(clientId, { info, until: Date.now() + ttl * 1000 });
  }
  return info;
}

/**
 * client_id -> client, or null when it is neither a client we registered
 * nor a fetchable, valid metadata document.
 */
export async function resolveClient(secret: string, clientId: unknown): Promise<ClientInfo | null> {
  if (typeof clientId !== 'string' || clientId.length === 0) return null;
  const dcr = unseal<{ n?: unknown; r?: unknown }>(secret, 'client', clientId);
  if (dcr !== null) {
    if (!Array.isArray(dcr.r) || !dcr.r.every(isAllowedRedirectUri)) return null;
    return { clientId, name: cleanName(dcr.n, 'AI assistant'), redirectUris: dcr.r, kind: 'dcr' };
  }
  if (!isCimdClientId(clientId)) return null;
  try {
    return await fetchCimd(clientId);
  } catch {
    return null;
  }
}
