import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/**
 * Access gate for a HOSTED demo.
 *
 * Demo mode signs every visitor in as the sample leader, so a demo on a
 * public address would let anyone use it (and spend the owner's model key).
 * With a gate installed, a visitor needs the access code once: either by
 * opening a link that carries it (`https://host/?access=CODE`) or by typing
 * it into the page shown to visitors without it. A cookie remembers them.
 *
 * A cookie is used instead of an Authorization header because the browser
 * app already sends its own Authorization header on every API call.
 */
const COOKIE = 'hg_demo_access';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const MAX_WRONG_PER_MINUTE = 20;
/**
 * Paths that must stay open: health checks, the MCP server (own keys), and
 * the parts of "Sign in with Hogaan" that an assistant's SERVERS call
 * directly, with no browser and so no access cookie: the two metadata
 * documents, client registration, token and revocation. These hand out
 * nothing on their own; a token still needs a code, and a code is only
 * issued on the consent screen. /oauth/authorize and the consent screen
 * are opened in the leader's browser and stay behind the gate: the access
 * code is the demo's sign-in.
 */
const OPEN_PATHS = new Set([
  '/healthz',
  '/readyz',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
  '/oauth/register',
  '/oauth/token',
  '/oauth/revoke',
]);

export const MIN_ACCESS_CODE_LENGTH = 8;

function sign(code: string): string {
  return createHmac('sha256', code).update('hogaan-demo-access-v1').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Hidden inputs that carry the current query string through the form. */
function carry(query: URLSearchParams): string {
  const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  let out = '';
  for (const [k, v] of query) {
    if (k !== 'access') out += `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`;
  }
  return out;
}

function page(
  message: string,
  action = '/',
  query: URLSearchParams = new URLSearchParams(),
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Hogaan demo</title>
<style>body{font-family:system-ui,sans-serif;background:#eaf4ff;color:#00004d;margin:0;display:grid;place-items:center;min-height:100vh}
main{background:#f4f9ff;border-radius:16px;padding:28px;max-width:360px;width:calc(100% - 32px);box-sizing:border-box}
h1{font-size:20px;margin:0 0 8px}p{margin:0 0 16px;color:#4a4a68;font-size:14px}
input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid #c2dcf5;font:inherit;margin-bottom:12px}
button{width:100%;padding:10px;border-radius:999px;border:0;background:#0068cc;color:#fff;font:inherit;font-weight:600;cursor:pointer}</style>
</head><body><main><h1>Hogaan demo</h1><p>${message}</p>
<form method="get" action="${action.replace(/[^A-Za-z0-9/_.-]/g, '')}">${carry(query)}<input name="access" type="password" autocomplete="off" aria-label="Access code" placeholder="Access code" required>
<button type="submit">Open the demo</button></form></main></body></html>`;
}

export function installAccessGate(app: FastifyInstance, code: string): void {
  const expected = sign(code);
  let windowStart = 0;
  let wrong = 0;

  app.addHook('onRequest', async (req, reply) => {
    const url = new URL(req.url, 'http://demo.local');
    const path = url.pathname;
    if (OPEN_PATHS.has(path) || path === '/mcp' || path.startsWith('/mcp/')) return;

    const deny = (status: number, message: string) =>
      reply
        .code(status)
        .header('Cache-Control', 'no-store')
        .type('text/html; charset=utf-8')
        .send(page(message, path, url.searchParams));

    const offered = url.searchParams.get('access');
    if (offered !== null) {
      const now = Date.now();
      if (now - windowStart > 60_000) {
        windowStart = now;
        wrong = 0;
      }
      if (wrong >= MAX_WRONG_PER_MINUTE) {
        return deny(429, 'Too many attempts. Wait a minute, then try again.');
      }
      if (!safeEqual(sign(offered), expected)) {
        wrong += 1;
        return deny(401, 'That access code is not right. Check the link you were sent.');
      }
      url.searchParams.delete('access');
      const secure = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https';
      return reply
        .code(302)
        .header(
          'Set-Cookie',
          `${COOKIE}=${expected}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`,
        )
        .header('Cache-Control', 'no-store')
        .header('Location', url.pathname + url.search)
        .send();
    }

    const cookie = readCookie(req.headers.cookie, COOKIE);
    if (cookie !== undefined && safeEqual(cookie, expected)) return;
    return deny(401, 'This demo is private. Enter the access code you were given.');
  });
}
