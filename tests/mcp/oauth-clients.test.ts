// P3.1b — the checks that decide which assistants and return addresses are
// trusted, and the guard that stops client-metadata fetches reaching
// private addresses (SSRF).
import { afterEach, describe, expect, it } from 'vitest';
import {
  isAllowedRedirectUri,
  isCimdClientId,
  isPublicAddress,
  redirectMatches,
  registerClient,
  resolveClient,
  setCimdFetcherForTests,
} from '../../src/mcp/oauth/clients.js';
import { seal, unseal } from '../../src/mcp/oauth/seal.js';

const SECRET = 'unit-secret-0123456789abcdefghijklmnopqrstuv';
const DOC_URL = 'https://assistant.example.com/client.json';

afterEach(() => setCimdFetcherForTests(null));

describe('return addresses', () => {
  it('allows https and http on localhost only', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:3118/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://example.com/cb')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai/cb#frag')).toBe(false);
    expect(isAllowedRedirectUri('https://user:pw@claude.ai/cb')).toBe(false);
    expect(isAllowedRedirectUri('myapp://cb')).toBe(false);
  });
  it('matches exactly, except the port on loopback', () => {
    expect(
      redirectMatches(
        'https://claude.ai/api/mcp/auth_callback',
        'https://claude.ai/api/mcp/auth_callback',
      ),
    ).toBe(true);
    expect(
      redirectMatches(
        'https://claude.ai/api/mcp/auth_callback',
        'https://claude.ai/api/mcp/auth_callback/x',
      ),
    ).toBe(false);
    expect(redirectMatches('https://claude.ai/cb', 'https://claude.ai:8443/cb')).toBe(false);
    expect(redirectMatches('http://localhost/callback', 'http://localhost:51234/callback')).toBe(
      true,
    );
    expect(redirectMatches('http://localhost/callback', 'http://127.0.0.1:51234/callback')).toBe(
      false,
    );
    expect(redirectMatches('http://localhost/callback', 'http://localhost:1/other')).toBe(false);
  });
});

describe('SSRF guard for client metadata', () => {
  it('treats private, loopback, link-local and metadata addresses as not public', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '224.0.0.1',
    ]) {
      expect(isPublicAddress(a), a).toBe(false);
    }
    for (const a of ['8.8.8.8', '160.79.104.10', '2606:4700::1111']) {
      expect(isPublicAddress(a), a).toBe(true);
    }
  });
  it('only fetches https URLs on 443 with a path, never an IP literal', () => {
    expect(isCimdClientId(DOC_URL)).toBe(true);
    expect(isCimdClientId('https://assistant.example.com/')).toBe(false);
    expect(isCimdClientId('http://assistant.example.com/c.json')).toBe(false);
    expect(isCimdClientId('https://assistant.example.com:8443/c.json')).toBe(false);
    expect(isCimdClientId('https://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isCimdClientId('https://[::1]/c.json')).toBe(false);
  });
});

describe('client metadata documents', () => {
  const serve = (json: unknown) =>
    setCimdFetcherForTests(() => Promise.resolve({ json, maxAgeSeconds: 0 }));
  it('accepts a valid document', async () => {
    serve({
      client_id: DOC_URL,
      client_name: 'Assistant',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    });
    expect(await resolveClient(SECRET, DOC_URL)).toMatchObject({ kind: 'cimd', name: 'Assistant' });
  });
  it('rejects a document that claims another client_id', async () => {
    serve({
      client_id: 'https://other.example/c.json',
      client_name: 'X',
      redirect_uris: ['https://claude.ai/cb'],
    });
    expect(await resolveClient(SECRET, DOC_URL)).toBeNull();
  });
  it('rejects unsafe redirect addresses and confidential clients', async () => {
    serve({ client_id: DOC_URL, client_name: 'X', redirect_uris: ['http://evil.example/cb'] });
    expect(await resolveClient(SECRET, DOC_URL)).toBeNull();
    serve({
      client_id: DOC_URL,
      client_name: 'X',
      redirect_uris: ['https://claude.ai/cb'],
      token_endpoint_auth_method: 'private_key_jwt',
    });
    expect(await resolveClient(SECRET, DOC_URL)).toBeNull();
  });
  it('strips control characters from the display name', async () => {
    serve({
      client_id: DOC_URL,
      client_name: 'Claude‮\u0000 evil',
      redirect_uris: ['https://claude.ai/cb'],
    });
    expect((await resolveClient(SECRET, DOC_URL))?.name).toBe('Claude evil');
  });
});

describe('registration and signed values', () => {
  it('a registered client id carries its own details and cannot be altered', async () => {
    const r = registerClient(SECRET, {
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/cb'],
    });
    expect(await resolveClient(SECRET, r.client_id)).toMatchObject({
      kind: 'dcr',
      redirectUris: ['https://claude.ai/cb'],
    });
    expect(await resolveClient('another-secret-0123456789abcdefghijklmn', r.client_id)).toBeNull();
    const [prefix, body, sig] = /^(hgc_)([^.]+)\.(.+)$/.exec(r.client_id)!.slice(1);
    const altered = Buffer.from(
      JSON.stringify({ n: 'x', r: ['https://evil.example/cb'], iat: 1 }),
    ).toString('base64url');
    expect(await resolveClient(SECRET, `${prefix}${altered}.${sig}`)).toBeNull();
    expect(body!.length).toBeGreaterThan(0);
  });
  it('kinds never cross, and expired values are refused', () => {
    const code = seal(SECRET, 'code', { a: 1, exp: Math.floor(Date.now() / 1000) + 60 });
    expect(unseal(SECRET, 'code', code)).toMatchObject({ a: 1 });
    expect(unseal(SECRET, 'access', code.replace(/^hgk_/, 'hgo_'))).toBeNull();
    expect(unseal(SECRET, 'code', seal(SECRET, 'code', { exp: 1 }))).toBeNull();
  });
});
