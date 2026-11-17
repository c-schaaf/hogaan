import formbody from '@fastify/formbody';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasCapability } from '../../entitlements/index.js';
import { reportP0 } from '../../incident-handling/index.js';
import { auditLog } from '../../shared/db/schema/audit-log.js';
import { isEnabled } from '../../shared/flags/index.js';
import type { AppConfig } from '../../shared/secrets/config.js';
import type { WebApiRoutesOpts } from '../../web-api/routes.js';
import { requireSupabaseSession } from '../../web-api/supabase-session.js';
import {
  ClientMetadataError,
  isLoopbackRedirect,
  redirectHost,
  redirectMatches,
  registerClient,
  resolveClient,
} from './clients.js';
import {
  createGrant,
  getGrant,
  grantByCode,
  listGrants,
  rehydrateDemoGrant,
  revokeGrant,
  rotateRefresh,
  touchGrant,
  type Grant,
} from './grants.js';
import {
  MIN_SECRET_LENGTH,
  newJti,
  nowSeconds,
  pkceMatches,
  seal,
  sha256,
  unseal,
} from './seal.js';

/**
 * P3.1b — "Sign in with Hogaan" for AI assistants: OAuth 2.1 as the MCP
 * authorization spec (2026-07-28 revision) describes it, with Hogaan as both
 * the authorization server and the protected resource (/mcp).
 *
 *   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728 metadata
 *   GET  /.well-known/oauth-authorization-server      RFC 8414 metadata
 *   POST /oauth/register     RFC 7591 Dynamic Client Registration (stateless)
 *   GET  /oauth/authorize    checks the request, sends the leader to the
 *                            consent screen in the app (/connect-assistant)
 *   GET  /api/oauth/request  (signed-in) what the consent screen shows
 *   POST /api/oauth/consent  (signed-in) Allow / Cancel -> where to go next
 *   POST /oauth/token        authorization_code (PKCE S256) and refresh_token
 *   POST /oauth/revoke       RFC 7009
 *   GET|DELETE /api/mcp/connections[/:id]   Profile: list and disconnect
 *
 * Everything answers 404 unless FEATURE_MCP and FEATURE_MCP_OAUTH are on,
 * and 503 if MCP_OAUTH_SECRET or PUBLIC_BASE_URL is missing.
 *
 * The leader is identified the same way as everywhere else in the app: the
 * consent screen is part of the browser app, and its two API calls carry
 * the leader's normal sign-in. /oauth/authorize itself identifies nobody.
 */

export const SCOPE = 'hogaan';
const OFFLINE = 'offline_access';
export const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 60 * 24 * 60 * 60;
const CODE_TTL_S = 5 * 60;
const REQUEST_TTL_S = 15 * 60;
/** A second refresh with the just-rotated token inside this window is a retry, not theft. */
const BENIGN_RETRY_MS = 60_000;
const REHYDRATED = 'rehydrated';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

export interface OAuthReady {
  base: string;
  secret: string;
  resource: string;
}

/** Feature on and configured -> the values every endpoint needs. */
export function oauthReady(config: AppConfig): OAuthReady | null {
  if (!isEnabled(config, 'mcp') || !isEnabled(config, 'mcpOAuth')) return null;
  const secret = config.mcpOAuthSecret;
  const base = config.publicBaseUrl?.replace(/\/+$/, '');
  if (secret === undefined || secret.length < MIN_SECRET_LENGTH) return null;
  if (base === undefined || base === '') return null;
  return { base, secret, resource: `${base}/mcp` };
}

export function resourceMetadataUrl(r: OAuthReady): string {
  return `${r.base}/.well-known/oauth-protected-resource/mcp`;
}

/** The 401 challenge on /mcp: tells the assistant where to start signing in. */
export function wwwAuthenticate(config: AppConfig, tokenWasSent: boolean): string {
  const r = oauthReady(config);
  if (r === null) return 'Bearer realm="hogaan"';
  return (
    `Bearer realm="hogaan", resource_metadata="${resourceMetadataUrl(r)}", scope="${SCOPE}"` +
    (tokenWasSent ? ', error="invalid_token"' : '')
  );
}

interface AccessPayload extends Record<string, unknown> {
  gid: string;
  sub: string;
  aud: string;
  scp: string;
  ck: string;
  cn: string;
  rh: string;
}
type RefreshPayload = AccessPayload & { jti: string };
interface CodePayload extends Record<string, unknown> {
  sub: string;
  ck: string;
  ru: string;
  cc: string;
  aud: string;
  scp: string;
  cn: string;
  rh: string;
  jti: string;
}
interface RequestPayload extends Record<string, unknown> {
  ci: string;
  ru: string;
  cc: string;
  st: string | null;
  aud: string;
  scp: string;
  cn: string;
  kind: 'cimd' | 'dcr';
}

const sameResource = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/** Requested scope -> what we grant ("hogaan", plus offline_access if asked). */
function grantedScope(raw: unknown): string {
  const asked = typeof raw === 'string' ? raw.split(/\s+/).filter(Boolean) : [];
  return asked.includes(OFFLINE) ? `${SCOPE} ${OFFLINE}` : SCOPE;
}

/**
 * Access token -> the leader it acts for, or null. Used by /mcp. Checks the
 * signature, expiry and audience, then the grant row (so a disconnected
 * assistant is refused at once, not when its token expires).
 */
export async function resolveOAuthAccess(
  opts: Pick<WebApiRoutesOpts, 'config' | 'db'>,
  token: string,
): Promise<string | null> {
  const r = oauthReady(opts.config);
  if (r === null) return null;
  const p = unseal<AccessPayload>(r.secret, 'access', token);
  if (p === null || typeof p.gid !== 'string' || !UUID_RE.test(p.gid)) return null;
  if (typeof p.aud !== 'string' || !sameResource(p.aud, r.resource)) return null;
  const g = await loadGrant(opts.config, opts.db, p, REHYDRATED);
  if (g === null || g.revokedAt !== null || g.clientKey !== p.ck) return null;
  if (opts.config.demoMode !== true && g.userId !== p.sub) return null;
  await touchGrant(opts.db, g.id);
  return g.userId;
}

async function loadGrant(
  config: AppConfig,
  db: WebApiRoutesOpts['db'],
  p: AccessPayload,
  refreshJtiHash: string,
): Promise<Grant | null> {
  const g = await getGrant(db, p.gid);
  if (g !== null || config.demoMode !== true) return g;
  return rehydrateDemoGrant(db, {
    id: p.gid,
    clientKey: String(p.ck),
    clientName: String(p.cn).slice(0, 100),
    redirectHost: String(p.rh).slice(0, 255),
    scope: String(p.scp),
    codeJti: `${REHYDRATED}:${p.gid}`,
    refreshJtiHash,
  });
}

// ------------------------------------------------------------ helpers

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function errorPage(reply: FastifyReply, message: string) {
  return reply
    .code(400)
    .header('Cache-Control', 'no-store')
    .type('text/html; charset=utf-8')
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Hogaan</title></head><body><main><h1>This connection could not start</h1><p>${esc(message)}</p><p>Go back to your assistant and try connecting again.</p></main></body></html>`,
    );
}

function redirectWith(uri: string, params: Record<string, string | null>, issuer: string): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  u.searchParams.set('iss', issuer);
  return u.toString();
}

function cors(reply: FastifyReply): FastifyReply {
  return reply
    .header('Access-Control-Allow-Origin', '*')
    .header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    .header('Access-Control-Allow-Headers', 'Content-Type, Authorization, MCP-Protocol-Version');
}

function tokenError(reply: FastifyReply, error: string, description: string, status = 400) {
  return cors(reply)
    .code(status)
    .header('Cache-Control', 'no-store')
    .send({ error, error_description: description });
}

/** Small per-address limiter for the unauthenticated endpoints. */
function limiter(perMinute: number) {
  const hits = new Map<string, { start: number; n: number }>();
  return (ip: string): boolean => {
    const t = Date.now();
    const h = hits.get(ip);
    if (h === undefined || t - h.start > 60_000) {
      if (hits.size > 5000) hits.clear();
      hits.set(ip, { start: t, n: 1 });
      return true;
    }
    h.n += 1;
    return h.n <= perMinute;
  };
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

// ------------------------------------------------------------ routes

export function registerMcpOAuthRoutes(app: FastifyInstance, opts: WebApiRoutesOpts): void {
  const flagOn = () => isEnabled(opts.config, 'mcp') && isEnabled(opts.config, 'mcpOAuth');
  if (flagOn() && oauthReady(opts.config) === null) {
    app.log.warn(
      'FEATURE_MCP_OAUTH is on but MCP_OAUTH_SECRET (32+ characters) or PUBLIC_BASE_URL is missing: "Sign in with Hogaan" is unavailable',
    );
  }
  /** null + reply sent when the feature is off or not configured. */
  const ready = (reply: FastifyReply): OAuthReady | null => {
    if (!flagOn()) {
      void reply.code(404).send({ error: 'feature_off' });
      return null;
    }
    const r = oauthReady(opts.config);
    if (r === null) void reply.code(503).send({ error: 'oauth_not_configured' });
    return r;
  };
  const registerLimit = limiter(20);
  const tokenLimit = limiter(120);

  const machinePaths = [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server',
    '/oauth/register',
    '/oauth/token',
    '/oauth/revoke',
  ];
  for (const p of machinePaths) {
    app.options(p, (_req, reply) =>
      flagOn() ? cors(reply).code(204).send() : reply.code(404).send(),
    );
  }

  const protectedResource = (_req: FastifyRequest, reply: FastifyReply) => {
    const r = ready(reply);
    if (r === null) return reply;
    return cors(reply).send({
      resource: r.resource,
      authorization_servers: [r.base],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'Hogaan',
    });
  };
  app.get('/.well-known/oauth-protected-resource', protectedResource);
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResource);

  app.get('/.well-known/oauth-authorization-server', (_req, reply) => {
    const r = ready(reply);
    if (r === null) return reply;
    return cors(reply).send({
      issuer: r.base,
      authorization_endpoint: `${r.base}/oauth/authorize`,
      token_endpoint: `${r.base}/oauth/token`,
      registration_endpoint: `${r.base}/oauth/register`,
      revocation_endpoint: `${r.base}/oauth/revoke`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [SCOPE, OFFLINE],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  app.post('/oauth/register', (req, reply) => {
    const r = ready(reply);
    if (r === null) return reply;
    if (!registerLimit(req.ip)) {
      return tokenError(
        reply,
        'temporarily_unavailable',
        'Too many registrations. Try again in a minute.',
        429,
      );
    }
    try {
      return cors(reply)
        .code(201)
        .header('Cache-Control', 'no-store')
        .send(registerClient(r.secret, req.body));
    } catch (err) {
      if (err instanceof ClientMetadataError) {
        return tokenError(reply, 'invalid_client_metadata', err.message);
      }
      throw err;
    }
  });

  app.get<{ Querystring: Record<string, unknown> }>('/oauth/authorize', async (req, reply) => {
    const r = ready(reply);
    if (r === null) return reply;
    const q = req.query;
    const client = await resolveClient(r.secret, q['client_id']);
    if (client === null) {
      return errorPage(reply, 'Hogaan does not recognise the assistant that sent you here.');
    }
    // Choose the return address before anything else: until it is known to
    // belong to this client, nothing may be sent to it (open redirect).
    const asked = str(q['redirect_uri']);
    let redirectUri: string | undefined;
    if (asked === undefined) {
      if (client.redirectUris.length === 1) redirectUri = client.redirectUris[0];
    } else if (client.redirectUris.some((u) => redirectMatches(u, asked))) {
      redirectUri = asked;
    }
    if (redirectUri === undefined) {
      return errorPage(reply, 'The return address does not belong to this assistant.');
    }
    const state = str(q['state']) ?? null;
    const fail = (error: string, description: string) =>
      reply
        .header('Cache-Control', 'no-store')
        .redirect(
          redirectWith(redirectUri, { error, error_description: description, state }, r.base),
        );
    if (q['response_type'] !== 'code')
      return fail('unsupported_response_type', 'Only "code" is supported.');
    const challenge = str(q['code_challenge']);
    if (
      q['code_challenge_method'] !== 'S256' ||
      challenge === undefined ||
      !CHALLENGE_RE.test(challenge)
    ) {
      return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
    }
    if (state !== null && state.length > 1024) return fail('invalid_request', 'state is too long.');
    const resource = str(q['resource']);
    if (resource !== undefined && !sameResource(resource, r.resource)) {
      return fail('invalid_target', 'This server only issues access to its own /mcp endpoint.');
    }
    const pending: RequestPayload = {
      ci: client.clientId,
      ru: redirectUri,
      cc: challenge,
      st: state,
      aud: r.resource,
      scp: grantedScope(q['scope']),
      cn: client.name,
      kind: client.kind,
      exp: nowSeconds() + REQUEST_TTL_S,
    };
    const req2 = seal(r.secret, 'request', pending);
    return reply
      .header('Cache-Control', 'no-store')
      .redirect(`/connect-assistant?req=${encodeURIComponent(req2)}`);
  });

  /** What the consent screen shows. Signed-in leaders only. */
  app.get<{ Querystring: { req?: string } }>('/api/oauth/request', async (req, reply) => {
    const r = ready(reply);
    if (r === null) return reply;
    const s = await requireSupabaseSession(req, reply, opts, 'E1_McpOAuthConsent');
    if (s === null) return reply;
    const p = unseal<RequestPayload>(r.secret, 'request', req.query.req);
    if (p === null) return reply.code(400).send({ error: 'request_expired' });
    return reply.header('Cache-Control', 'no-store').send({
      clientName: p.cn,
      // Shown so a client cannot hide behind a borrowed name (MCP spec:
      // the server MUST clearly display the redirect hostname).
      returnsTo: redirectHost(p.ru),
      localApp: isLoopbackRedirect(p.ru),
      publishedBy: p.kind === 'cimd' ? redirectHost(p.ci) : null,
      allowed: await hasCapability(opts.config, opts.db, s.userId, 'mcp'),
    });
  });

  app.post<{ Body: { req?: unknown; approve?: unknown } }>(
    '/api/oauth/consent',
    async (req, reply) => {
      const r = ready(reply);
      if (r === null) return reply;
      const s = await requireSupabaseSession(req, reply, opts, 'E1_McpOAuthConsent');
      if (s === null) return reply;
      const p = unseal<RequestPayload>(r.secret, 'request', req.body?.req);
      if (p === null) return reply.code(400).send({ error: 'request_expired' });
      if (req.body?.approve !== true) {
        return reply.send({
          redirectTo: redirectWith(
            p.ru,
            { error: 'access_denied', error_description: 'The leader cancelled.', state: p.st },
            r.base,
          ),
        });
      }
      if (!(await hasCapability(opts.config, opts.db, s.userId, 'mcp'))) {
        return reply.code(402).send({ error: 'upgrade_required', capability: 'mcp' });
      }
      // Fail-closed: no audit row, no connection.
      try {
        await opts.db.insert(auditLog).values({
          requestId: req.id,
          triggerSource: 'mcp',
          userId: s.userId,
          targetEndEvent: 'MCP_OAUTH_CONSENT',
          ipAddress: req.ip ?? null,
        });
      } catch (err) {
        reportP0(
          'mcp-oauth: consent audit insert failed (fail-closed)',
          { source: 'Mcp.OAuth' },
          err,
        );
        return reply.code(503).send({ error: 'audit_unavailable' });
      }
      const code: CodePayload = {
        sub: s.userId,
        ck: sha256(p.ci),
        ru: p.ru,
        cc: p.cc,
        aud: p.aud,
        scp: p.scp,
        cn: p.cn,
        rh: redirectHost(p.ru),
        jti: newJti(),
        exp: nowSeconds() + CODE_TTL_S,
      };
      return reply.header('Cache-Control', 'no-store').send({
        redirectTo: redirectWith(p.ru, { code: seal(r.secret, 'code', code), state: p.st }, r.base),
      });
    },
  );

  // Token and revocation take form bodies (RFC 6749 §3.2), so they get their
  // own encapsulated parser; nothing else in the app accepts form posts.
  void app.register(async (scoped) => {
    await scoped.register(formbody);

    scoped.post<{ Body: Record<string, unknown> }>('/oauth/token', async (req, reply) => {
      const r = ready(reply);
      if (r === null) return reply;
      if (!tokenLimit(req.ip))
        return tokenError(reply, 'temporarily_unavailable', 'Too many requests.', 429);
      const b = req.body ?? {};
      const clientId = str(b['client_id']);
      if (clientId === undefined)
        return tokenError(reply, 'invalid_client', 'client_id is required.', 401);
      const resource = str(b['resource']);

      const issue = (
        g: {
          id: string;
          userId: string;
          clientKey: string;
          clientName: string;
          redirectHost: string;
          scope: string;
        },
        refreshJti: string,
      ) => {
        const base: AccessPayload = {
          gid: g.id,
          sub: g.userId,
          aud: r.resource,
          scp: g.scope,
          ck: g.clientKey,
          cn: g.clientName,
          rh: g.redirectHost,
        };
        const iat = nowSeconds();
        return cors(reply)
          .header('Cache-Control', 'no-store')
          .header('Pragma', 'no-cache')
          .send({
            access_token: seal(r.secret, 'access', {
              ...base,
              iat,
              exp: iat + ACCESS_TTL_S,
              jti: newJti(),
            }),
            token_type: 'Bearer',
            expires_in: ACCESS_TTL_S,
            refresh_token: seal(r.secret, 'refresh', {
              ...base,
              iat,
              exp: iat + REFRESH_TTL_S,
              jti: refreshJti,
            }),
            scope: g.scope,
          });
      };

      if (b['grant_type'] === 'authorization_code') {
        const c = unseal<CodePayload>(r.secret, 'code', b['code']);
        if (c === null)
          return tokenError(reply, 'invalid_grant', 'The code is invalid or has expired.');
        if (sha256(clientId) !== c.ck)
          return tokenError(reply, 'invalid_grant', 'The code was issued to another client.');
        const ru = str(b['redirect_uri']);
        if (ru !== undefined && ru !== c.ru)
          return tokenError(reply, 'invalid_grant', 'redirect_uri does not match.');
        const verifier = str(b['code_verifier']);
        if (verifier === undefined || !pkceMatches(verifier, c.cc)) {
          return tokenError(reply, 'invalid_grant', 'code_verifier does not match.');
        }
        if (resource !== undefined && !sameResource(resource, c.aud)) {
          return tokenError(reply, 'invalid_target', 'resource does not match.');
        }
        const refreshJti = newJti();
        const id = await createGrant(opts.db, {
          userId: c.sub,
          clientKey: c.ck,
          clientName: c.cn,
          redirectHost: c.rh,
          scope: c.scp,
          codeJti: c.jti,
          refreshJtiHash: sha256(refreshJti),
        });
        if (id === null) {
          // The code was used before: someone may have intercepted it. End
          // the connection it created (OAuth 2.1 §4.1.3).
          const earlier = await grantByCode(opts.db, c.jti);
          if (earlier !== null) await revokeGrant(opts.db, earlier.id);
          return tokenError(reply, 'invalid_grant', 'The code was already used.');
        }
        return issue(
          {
            id,
            userId: c.sub,
            clientKey: c.ck,
            clientName: c.cn,
            redirectHost: c.rh,
            scope: c.scp,
          },
          refreshJti,
        );
      }

      if (b['grant_type'] === 'refresh_token') {
        const t = unseal<RefreshPayload>(r.secret, 'refresh', b['refresh_token']);
        if (
          t === null ||
          typeof t.gid !== 'string' ||
          !UUID_RE.test(t.gid) ||
          typeof t.jti !== 'string'
        ) {
          return tokenError(reply, 'invalid_grant', 'The refresh token is invalid or has expired.');
        }
        if (sha256(clientId) !== t.ck)
          return tokenError(reply, 'invalid_grant', 'The refresh token belongs to another client.');
        if (resource !== undefined && !sameResource(resource, t.aud)) {
          return tokenError(reply, 'invalid_target', 'resource does not match.');
        }
        const g = await loadGrant(opts.config, opts.db, t, REHYDRATED);
        if (g === null || g.revokedAt !== null || g.clientKey !== t.ck) {
          return tokenError(reply, 'invalid_grant', 'This connection has ended. Connect again.');
        }
        const presented = sha256(t.jti);
        const expected =
          g.refreshJtiHash === REHYDRATED && opts.config.demoMode === true ? REHYDRATED : presented;
        if (g.refreshJtiHash !== expected) {
          const benign =
            g.prevRefreshJtiHash === presented &&
            g.rotatedAt !== null &&
            Date.now() - g.rotatedAt.getTime() < BENIGN_RETRY_MS;
          // A refresh token used after it was replaced means two parties hold
          // it: end the connection (OAuth 2.1 §4.3.1). A retry within a
          // minute of the rotation is treated as a network retry instead.
          if (!benign) await revokeGrant(opts.db, g.id);
          return tokenError(reply, 'invalid_grant', 'The refresh token was already used.');
        }
        const nextJti = newJti();
        if (!(await rotateRefresh(opts.db, g.id, expected, sha256(nextJti), presented))) {
          return tokenError(reply, 'invalid_grant', 'The refresh token was already used.');
        }
        return issue(g, nextJti);
      }

      return tokenError(
        reply,
        'unsupported_grant_type',
        'Use authorization_code or refresh_token.',
      );
    });

    // RFC 7009: always 200, whether or not the token was valid.
    scoped.post<{ Body: Record<string, unknown> }>('/oauth/revoke', async (req, reply) => {
      const r = ready(reply);
      if (r === null) return reply;
      if (!tokenLimit(req.ip))
        return tokenError(reply, 'temporarily_unavailable', 'Too many requests.', 429);
      const b = req.body ?? {};
      const t =
        unseal<AccessPayload>(r.secret, 'refresh', b['token']) ??
        unseal<AccessPayload>(r.secret, 'access', b['token']);
      const clientId = str(b['client_id']);
      if (
        t !== null &&
        UUID_RE.test(String(t.gid)) &&
        (clientId === undefined || sha256(clientId) === t.ck)
      ) {
        const g = await getGrant(opts.db, t.gid);
        if (g !== null && g.clientKey === t.ck) await revokeGrant(opts.db, g.id);
      }
      return cors(reply).code(200).send();
    });
  });

  // Profile: the leader's connected assistants.
  app.get('/api/mcp/connections', async (req, reply) => {
    if (!flagOn()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_McpTokens');
    if (s === null) return reply;
    return reply.send({ connections: await listGrants(opts.db, s.userId) });
  });

  app.delete<{ Params: { id: string } }>('/api/mcp/connections/:id', async (req, reply) => {
    if (!flagOn()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_McpTokens');
    if (s === null) return reply;
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: 'invalid_id' });
    const ok = await revokeGrant(opts.db, req.params.id, s.userId);
    return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'not_found' });
  });
}
