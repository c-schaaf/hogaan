// P3.1b on a HOSTED demo: the owner pastes only https://<demo>/mcp into
// Claude and clicks Connect. This test plays both sides against the real
// demo server (access gate on, in-memory database), then restarts the demo
// — which wipes the database, as Railway's sleep does — and checks that the
// connected assistant keeps working without reconnecting.
import { afterAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { startDemoServer, type DemoServer } from '../../src/demo/server.js';
import { DEMO_ACCESS_TOKEN } from '../../src/web-api/supabase-session.js';

const CODE = 'correct-horse-battery';
const PORT = '3996';
const BASE = `http://127.0.0.1:${PORT}`;
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const saved = { ...process.env };
const env = () => ({
  NODE_ENV: 'test',
  PORT,
  LOG_LEVEL: 'error',
  DEMO_HOSTED: 'true',
  DEMO_ACCESS_CODE: CODE,
  PUBLIC_BASE_URL: BASE,
  MCP_OAUTH_SECRET: 'demo-oauth-secret-for-tests-0123456789abcdef',
});
const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};
const LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

let demo: DemoServer | undefined;
afterAll(async () => {
  await demo?.close();
  process.env = { ...saved };
});

async function start(): Promise<DemoServer> {
  process.env = env();
  return startDemoServer({ webDistDir: '/nonexistent' });
}

describe('hosted demo: Sign in with Hogaan', () => {
  let clientId = '';
  let tokens: { access_token: string; refresh_token: string } = {
    access_token: '',
    refresh_token: '',
  };

  it('the machine-to-machine endpoints are reachable without the access code; authorize is not', async () => {
    demo = await start();
    expect(
      (await fetch(`${BASE}/mcp`, { method: 'POST', headers: MCP_HEADERS, body: LIST })).status,
    ).toBe(401);
    expect((await fetch(`${BASE}/.well-known/oauth-protected-resource/mcp`)).status).toBe(200);
    expect((await fetch(`${BASE}/.well-known/oauth-authorization-server`)).status).toBe(200);
    const reg = await fetch(`${BASE}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK] }),
    });
    expect(reg.status).toBe(201);
    clientId = ((await reg.json()) as { client_id: string }).client_id;
    // Still gated: the browser pages and every /api route.
    expect(
      (await fetch(`${BASE}/oauth/authorize?client_id=x`, { redirect: 'manual' })).status,
    ).toBe(401);
    expect((await fetch(`${BASE}/api/oauth/request?req=x`)).status).toBe(401);
    expect((await fetch(`${BASE}/connect-assistant`)).status).toBe(401);
    // Near-miss paths stay closed.
    expect((await fetch(`${BASE}/oauth/tokenx`, { method: 'POST' })).status).toBe(401);
    expect(
      (await fetch(`${BASE}/.well-known/oauth-protected-resource/../../api/profile`)).status,
    ).toBe(401);
  });

  it('the leader enters the access code once and lands back on the sign-in request', async () => {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CALLBACK,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'st-1',
      resource: `${BASE}/mcp`,
    });
    // No cookie yet: the gate page carries the request through its form.
    const gate = await fetch(`${BASE}/oauth/authorize?${q.toString()}`, { redirect: 'manual' });
    expect(gate.status).toBe(401);
    const html = await gate.text();
    expect(html).toContain('action="/oauth/authorize"');
    expect(html).toContain(`name="code_challenge" value="${challenge}"`);
    // Submitting the form = the same query plus access=CODE.
    const withCode = await fetch(`${BASE}/oauth/authorize?${q.toString()}&access=${CODE}`, {
      redirect: 'manual',
    });
    expect(withCode.status).toBe(302);
    const cookie = withCode.headers.get('set-cookie')!.split(';')[0]!;
    const back = new URL(withCode.headers.get('location')!, BASE);
    expect(back.pathname).toBe('/oauth/authorize');
    expect(back.searchParams.get('client_id')).toBe(clientId);
    // With the cookie, authorize sends the leader to the consent screen.
    const auth = await fetch(back, { redirect: 'manual', headers: { cookie } });
    expect(auth.status).toBe(302);
    const req = new URL(auth.headers.get('location')!, BASE).searchParams.get('req')!;
    const app = {
      cookie,
      authorization: `Bearer ${DEMO_ACCESS_TOKEN}`,
      'content-type': 'application/json',
    };
    const view = await fetch(`${BASE}/api/oauth/request?req=${encodeURIComponent(req)}`, {
      headers: app,
    });
    expect(await view.json()).toMatchObject({
      clientName: 'Claude',
      returnsTo: 'claude.ai',
      allowed: true,
    });
    const consent = await fetch(`${BASE}/api/oauth/consent`, {
      method: 'POST',
      headers: app,
      body: JSON.stringify({ req, approve: true }),
    });
    const redirectTo = new URL(((await consent.json()) as { redirectTo: string }).redirectTo);
    // Claude's servers exchange the code: no cookie.
    const tok = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: redirectTo.searchParams.get('code')!,
        client_id: clientId,
        code_verifier: verifier,
        redirect_uri: CALLBACK,
        resource: `${BASE}/mcp`,
      }).toString(),
    });
    expect(tok.status).toBe(200);
    tokens = (await tok.json()) as typeof tokens;
    const use = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, authorization: `Bearer ${tokens.access_token}` },
      body: LIST,
    });
    expect(use.status).toBe(200);
  }, 30_000);

  it('after a restart (database wiped) the same tokens still work, and refresh still works', async () => {
    await demo!.close();
    demo = await start();
    const use = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, authorization: `Bearer ${tokens.access_token}` },
      body: LIST,
    });
    expect(use.status).toBe(200);
    const refresh = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      }).toString(),
    });
    expect(refresh.status).toBe(200);
    const next = (await refresh.json()) as typeof tokens;
    // The rotated token is now the only valid one.
    const reuse = await fetch(`${BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: clientId,
      }).toString(),
    });
    expect(reuse.status).toBe(400);
    const use2 = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, authorization: `Bearer ${next.access_token}` },
      body: LIST,
    });
    expect(use2.status).toBe(200);
  }, 60_000);

  it('a demo started with a different secret refuses the old tokens', async () => {
    await demo!.close();
    process.env = { ...env(), MCP_OAUTH_SECRET: 'a-different-secret-0123456789abcdefghijkl' };
    demo = await startDemoServer({ webDistDir: '/nonexistent' });
    const use = await fetch(`${BASE}/mcp`, {
      method: 'POST',
      headers: { ...MCP_HEADERS, authorization: `Bearer ${tokens.access_token}` },
      body: LIST,
    });
    expect(use.status).toBe(401);
  }, 60_000);
});
