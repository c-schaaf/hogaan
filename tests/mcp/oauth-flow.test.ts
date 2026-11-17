/**
 * P3.1b "Done when": an OAuth-capable MCP client connects to Hogaan with
 * "Sign in with Hogaan" — no key to copy — and can then use Hogaan's tools.
 *
 * The assistant here is the official MCP TypeScript client with its own
 * OAuth support (the same discovery, registration, PKCE and token steps
 * Claude performs). It finds the sign-in from the 401 on /mcp, registers
 * (Dynamic Client Registration, and separately a Client ID Metadata
 * Document), sends the leader to /oauth/authorize, and the test plays the
 * leader's browser: the consent screen's two API calls and the return to
 * the assistant. Then refresh, disconnect, and every refusal path.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type * as Session from '../../src/web-api/supabase-session.js';
import { setCimdFetcherForTests } from '../../src/mcp/oauth/clients.js';
import { seal } from '../../src/mcp/oauth/seal.js';
import type { EmbeddedDb } from '../../src/shared/db/embedded.js';
import { resetEncryptionCache } from '../../src/shared/db/encryption.js';
import { auditLog } from '../../src/shared/db/schema/audit-log.js';
import { mcpOAuthGrants } from '../../src/shared/db/schema/mcp-oauth.js';
import { buildRealApp, insertLeader } from '../helpers/app.js';
import { demoTestConfig, embeddedTestDb } from '../helpers/embedded.js';

let current = '';
vi.mock('../../src/web-api/supabase-session.js', async (orig) => ({
  ...(await orig<typeof Session>()),
  requireSupabaseSession: vi.fn(() => Promise.resolve({ userId: current })),
}));

const SECRET = 'test-oauth-secret-0123456789-abcdefghijklmnop';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const CIMD_URL = 'https://assistant.example.com/oauth/client-metadata.json';

const config = demoTestConfig({
  demoMode: false,
  mcpOAuthSecret: SECRET,
  features: { ...demoTestConfig().features, billing: false, mcpOAuth: true },
});
let edb: EmbeddedDb;
let app: FastifyInstance;
let base = '';

class TestAssistant implements OAuthClientProvider {
  info: OAuthClientInformationMixed | undefined;
  tok: OAuthTokens | undefined;
  verifier = '';
  authUrl: URL | undefined;
  clientMetadataUrl?: string;
  constructor(cimd?: string) {
    if (cimd !== undefined) this.clientMetadataUrl = cimd;
  }
  get redirectUrl() {
    return CALLBACK;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Test Assistant',
      redirect_uris: [CALLBACK],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(i: OAuthClientInformationMixed) {
    this.info = i;
  }
  tokens() {
    return this.tok;
  }
  saveTokens(t: OAuthTokens) {
    this.tok = t;
  }
  redirectToAuthorization(u: URL) {
    this.authUrl = u;
  }
  saveCodeVerifier(v: string) {
    this.verifier = v;
  }
  codeVerifier() {
    return this.verifier;
  }
}

/** The leader's browser: open the authorize link, look, choose. */
async function leaderDecides(authUrl: URL, approve = true): Promise<URL> {
  const r1 = await fetch(authUrl, { redirect: 'manual' });
  expect(r1.status).toBe(302);
  const consentPage = new URL(r1.headers.get('location')!, base);
  expect(consentPage.pathname).toBe('/connect-assistant');
  const req = consentPage.searchParams.get('req')!;
  const view = await app.inject({ url: `/api/oauth/request?req=${encodeURIComponent(req)}` });
  expect(view.statusCode).toBe(200);
  expect(view.json()).toMatchObject({
    clientName: 'Test Assistant',
    returnsTo: 'claude.ai',
    allowed: true,
  });
  const c = await app.inject({
    method: 'POST',
    url: '/api/oauth/consent',
    payload: { req, approve },
  });
  expect(c.statusCode).toBe(200);
  return new URL(c.json<{ redirectTo: string }>().redirectTo);
}

async function connectWithSignIn(assistant: TestAssistant): Promise<Client> {
  const url = new URL(`${base}/mcp`);
  const first = new Client({ name: 'test-assistant', version: '1.0.0' });
  await expect(
    first.connect(new StreamableHTTPClientTransport(url, { authProvider: assistant })),
  ).rejects.toThrow(UnauthorizedError);
  const back = await leaderDecides(assistant.authUrl!);
  expect(back.origin + back.pathname).toBe(CALLBACK);
  expect(back.searchParams.get('state')).toBe(assistant.authUrl!.searchParams.get('state'));
  expect(back.searchParams.get('iss')).toBe(base);
  const t = new StreamableHTTPClientTransport(url, { authProvider: assistant });
  await t.finishAuth(back.searchParams.get('code')!);
  const client = new Client({ name: 'test-assistant', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: assistant }));
  return client;
}

const form = (body: Record<string, string>) =>
  fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

beforeAll(async () => {
  resetEncryptionCache();
  edb = await embeddedTestDb();
  current = await insertLeader(config, edb.db, 'Amina Farah');
  app = await buildRealApp(config, edb.db);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr !== null ? addr.port : 0}`;
  config.publicBaseUrl = base;
}, 60_000);
afterAll(async () => {
  setCimdFetcherForTests(null);
  await app.close();
  await edb.close();
});

describe('P3.1b Sign in with Hogaan', () => {
  it('tells an assistant where to sign in: 401 challenge and both metadata documents', async () => {
    const r = await fetch(`${base}/mcp`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain(
      `resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
    );
    const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json();
    expect(prm).toMatchObject({ resource: `${base}/mcp`, authorization_servers: [base] });
    const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
    expect(as).toMatchObject({
      issuer: base,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
    });
  });

  let dcrAssistant: TestAssistant;
  it('connects end to end with Dynamic Client Registration, then uses a tool', async () => {
    dcrAssistant = new TestAssistant();
    const client = await connectWithSignIn(dcrAssistant);
    expect(String(dcrAssistant.info?.client_id)).toMatch(/^hgc_/);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('get_leader_context');
    const res = await client.callTool({ name: 'get_leader_context', arguments: {} });
    expect(res.isError).not.toBe(true);
    await client.close();
    // The consent was audited, and the connection is on the leader's Profile.
    const audits = await edb.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, current), eq(auditLog.targetEndEvent, 'MCP_OAUTH_CONSENT')));
    expect(audits.length).toBe(1);
    const list = (await app.inject({ url: '/api/mcp/connections' })).json<{
      connections: { clientName: string; redirectHost: string }[];
    }>();
    expect(list.connections).toEqual([
      expect.objectContaining({ clientName: 'Test Assistant', redirectHost: 'claude.ai' }),
    ]);
  });

  it("connects end to end with a Client ID Metadata Document (Claude's default)", async () => {
    const fetched: string[] = [];
    setCimdFetcherForTests((u) => {
      fetched.push(u.toString());
      return Promise.resolve({
        json: {
          client_id: CIMD_URL,
          client_name: 'Test Assistant',
          redirect_uris: [CALLBACK],
          token_endpoint_auth_method: 'none',
        },
        maxAgeSeconds: 300,
      });
    });
    const a = new TestAssistant(CIMD_URL);
    const client = await connectWithSignIn(a);
    expect(a.info?.client_id).toBe(CIMD_URL);
    expect(fetched).toContain(CIMD_URL);
    const res = await client.callTool({ name: 'get_leader_context', arguments: {} });
    expect(res.isError).not.toBe(true);
    await client.close();
  });

  it('refreshes with rotation; reusing an old refresh token ends the connection', async () => {
    const clientId = String(dcrAssistant.info!.client_id);
    const first = dcrAssistant.tok!.refresh_token!;
    const r1 = await form({
      grant_type: 'refresh_token',
      refresh_token: first,
      client_id: clientId,
    });
    expect(r1.status).toBe(200);
    const t1 = (await r1.json()) as OAuthTokens;
    expect(t1.refresh_token).not.toBe(first);
    // An immediate second use is treated as a network retry: refused, connection kept.
    const retry = await form({
      grant_type: 'refresh_token',
      refresh_token: first,
      client_id: clientId,
    });
    expect(retry.status).toBe(400);
    expect(await retry.json()).toMatchObject({ error: 'invalid_grant' });
    const t1Works = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${t1.access_token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(t1Works.status).toBe(200);
    // Later reuse means the token leaked: the whole connection is ended.
    await edb.db
      .update(mcpOAuthGrants)
      .set({ rotatedAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(mcpOAuthGrants.clientName, 'Test Assistant'));
    const late = await form({
      grant_type: 'refresh_token',
      refresh_token: first,
      client_id: clientId,
    });
    expect(await late.json()).toMatchObject({ error: 'invalid_grant' });
    const after = await form({
      grant_type: 'refresh_token',
      refresh_token: t1.refresh_token!,
      client_id: clientId,
    });
    expect(await after.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('Disconnect on Profile ends the connection at once (access and refresh)', async () => {
    const a = new TestAssistant();
    const client = await connectWithSignIn(a);
    await client.close();
    const list = (await app.inject({ url: '/api/mcp/connections' })).json<{
      connections: { id: string }[];
    }>();
    for (const c of list.connections) {
      expect(
        (await app.inject({ method: 'DELETE', url: `/api/mcp/connections/${c.id}` })).statusCode,
      ).toBe(200);
    }
    const r = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${a.tok!.access_token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain('error="invalid_token"');
    const rf = await form({
      grant_type: 'refresh_token',
      refresh_token: a.tok!.refresh_token!,
      client_id: String(a.info!.client_id),
    });
    expect(await rf.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('Cancel on the consent screen returns access_denied and creates nothing', async () => {
    const a = new TestAssistant();
    await expect(
      new Client({ name: 't', version: '1' }).connect(
        new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { authProvider: a }),
      ),
    ).rejects.toThrow(UnauthorizedError);
    const before = (await edb.db.select().from(mcpOAuthGrants)).length;
    const back = await leaderDecides(a.authUrl!, false);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('code')).toBeNull();
    expect((await edb.db.select().from(mcpOAuthGrants)).length).toBe(before);
  });
});

describe('P3.1b refusals', () => {
  let clientId = '';
  beforeAll(async () => {
    const reg = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Probe', redirect_uris: [CALLBACK] }),
    });
    expect(reg.status).toBe(201);
    clientId = ((await reg.json()) as { client_id: string }).client_id;
  });

  /** Authorize -> consent -> code, done by hand. */
  async function code(challenge: string, extra: Record<string, string> = {}) {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      ...extra,
    });
    const r = await fetch(`${base}/oauth/authorize?${q.toString()}`, { redirect: 'manual' });
    const req = new URL(r.headers.get('location')!, base).searchParams.get('req')!;
    const c = await app.inject({
      method: 'POST',
      url: '/api/oauth/consent',
      payload: { req, approve: true },
    });
    return new URL(c.json<{ redirectTo: string }>().redirectTo).searchParams.get('code')!;
  }

  it('never redirects to an address the client did not register (no open redirect)', async () => {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: 'https://evil.example/cb',
      code_challenge: pkce().challenge,
      code_challenge_method: 'S256',
    });
    const r = await fetch(`${base}/oauth/authorize?${q.toString()}`, { redirect: 'manual' });
    expect(r.status).toBe(400);
    expect(r.headers.get('location')).toBeNull();
    const unknown = await fetch(
      `${base}/oauth/authorize?client_id=hgc_forged.sig&redirect_uri=${encodeURIComponent(CALLBACK)}`,
      { redirect: 'manual' },
    );
    expect(unknown.status).toBe(400);
  });

  it('requires PKCE S256 and the right resource', async () => {
    const base_q = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CALLBACK,
      state: 's',
    };
    const noPkce = await fetch(
      `${base}/oauth/authorize?${new URLSearchParams(base_q).toString()}`,
      {
        redirect: 'manual',
      },
    );
    expect(new URL(noPkce.headers.get('location')!).searchParams.get('error')).toBe(
      'invalid_request',
    );
    const plain = await fetch(
      `${base}/oauth/authorize?${new URLSearchParams({ ...base_q, code_challenge: pkce().challenge, code_challenge_method: 'plain' }).toString()}`,
      { redirect: 'manual' },
    );
    expect(new URL(plain.headers.get('location')!).searchParams.get('error')).toBe(
      'invalid_request',
    );
    const other = await fetch(
      `${base}/oauth/authorize?${new URLSearchParams({ ...base_q, code_challenge: pkce().challenge, code_challenge_method: 'S256', resource: 'https://other.example/mcp' }).toString()}`,
      { redirect: 'manual' },
    );
    expect(new URL(other.headers.get('location')!).searchParams.get('error')).toBe(
      'invalid_target',
    );
  });

  it('a code needs the right verifier and client, and works only once', async () => {
    const p = pkce();
    const c = await code(p.challenge);
    const wrongVerifier = await form({
      grant_type: 'authorization_code',
      code: c,
      client_id: clientId,
      code_verifier: pkce().verifier,
      redirect_uri: CALLBACK,
    });
    expect(await wrongVerifier.json()).toMatchObject({ error: 'invalid_grant' });
    const wrongClient = await form({
      grant_type: 'authorization_code',
      code: c,
      client_id: 'someone-else',
      code_verifier: p.verifier,
    });
    expect(await wrongClient.json()).toMatchObject({ error: 'invalid_grant' });
    const ok = await form({
      grant_type: 'authorization_code',
      code: c,
      client_id: clientId,
      code_verifier: p.verifier,
      redirect_uri: CALLBACK,
      resource: `${base}/mcp`,
    });
    expect(ok.status).toBe(200);
    const tokens = (await ok.json()) as OAuthTokens;
    const again = await form({
      grant_type: 'authorization_code',
      code: c,
      client_id: clientId,
      code_verifier: p.verifier,
    });
    expect(await again.json()).toMatchObject({ error: 'invalid_grant' });
    // Reusing a code ends the connection it created.
    const r = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.access_token}` },
      body: '{}',
    });
    expect(r.status).toBe(401);
  });

  it('refuses forged, tampered, wrong-audience and wrong-kind tokens', async () => {
    const p = pkce();
    const c = await code(p.challenge);
    const t = (await (
      await form({
        grant_type: 'authorization_code',
        code: c,
        client_id: clientId,
        code_verifier: p.verifier,
      })
    ).json()) as OAuthTokens;
    const call = (tok: string) =>
      fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${tok}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
    expect((await call(t.access_token)).status).toBe(200);
    expect((await call(t.access_token.slice(0, -2) + 'xx')).status).toBe(401);
    // A refresh token is not an access token.
    expect((await call(t.refresh_token!.replace(/^hgf_/, 'hgo_'))).status).toBe(401);
    // Signed with another secret.
    const grant = (await edb.db.select().from(mcpOAuthGrants).limit(1))[0]!;
    const forged = seal('another-secret-entirely-0123456789abcdef', 'access', {
      gid: grant.id,
      sub: current,
      aud: `${base}/mcp`,
      ck: grant.clientKey,
      exp: 9e9,
    });
    expect((await call(forged)).status).toBe(401);
    // Right secret, but issued for a different server.
    const elsewhere = seal(SECRET, 'access', {
      gid: grant.id,
      sub: grant.userId,
      aud: 'https://other.example/mcp',
      ck: grant.clientKey,
      exp: 9e9,
    });
    expect((await call(elsewhere)).status).toBe(401);
    // An OAuth token is never accepted in an address.
    expect((await call('')).status).toBe(401);
  });

  it('rejects registrations with unsafe return addresses or confidential clients', async () => {
    const bad = async (body: unknown) =>
      (
        await fetch(`${base}/oauth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).status;
    expect(await bad({ redirect_uris: ['http://evil.example/cb'] })).toBe(400);
    expect(await bad({ redirect_uris: ['javascript:alert(1)'] })).toBe(400);
    expect(await bad({ redirect_uris: [] })).toBe(400);
    expect(
      await bad({ redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_basic' }),
    ).toBe(400);
    expect(await bad({ redirect_uris: ['http://localhost/callback'] })).toBe(201);
  });

  it('in the real app, a token whose connection row is gone is refused', async () => {
    const p = pkce();
    const c = await code(p.challenge);
    const t = (await (
      await form({
        grant_type: 'authorization_code',
        code: c,
        client_id: clientId,
        code_verifier: p.verifier,
      })
    ).json()) as OAuthTokens;
    await edb.db.delete(mcpOAuthGrants);
    const r = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${t.access_token}` },
      body: '{}',
    });
    expect(r.status).toBe(401);
    const rf = await form({
      grant_type: 'refresh_token',
      refresh_token: t.refresh_token!,
      client_id: clientId,
    });
    expect(await rf.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it('a leader without the plan sees "not included" and gets no code', async () => {
    config.features = { ...config.features, billing: true };
    try {
      const fresh = await insertLeader(config, edb.db, 'Free Leader');
      const was = current;
      current = fresh;
      const q = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: CALLBACK,
        code_challenge: pkce().challenge,
        code_challenge_method: 'S256',
      });
      const r = await fetch(`${base}/oauth/authorize?${q.toString()}`, { redirect: 'manual' });
      const req = new URL(r.headers.get('location')!, base).searchParams.get('req')!;
      expect(
        (await app.inject({ url: `/api/oauth/request?req=${encodeURIComponent(req)}` })).json(),
      ).toMatchObject({ allowed: false });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/oauth/consent',
            payload: { req, approve: true },
          })
        ).statusCode,
      ).toBe(402);
      current = was;
    } finally {
      config.features = { ...config.features, billing: false };
    }
  });

  it('everything is off when the feature flag is off', async () => {
    config.features = { ...config.features, mcpOAuth: false };
    try {
      expect((await fetch(`${base}/.well-known/oauth-authorization-server`)).status).toBe(404);
      expect((await fetch(`${base}/oauth/token`, { method: 'POST' })).status).toBe(404);
      const r = await fetch(`${base}/mcp`, {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      });
      expect(r.headers.get('www-authenticate')).toBe('Bearer realm="hogaan"');
    } finally {
      config.features = { ...config.features, mcpOAuth: true };
    }
  });
});
