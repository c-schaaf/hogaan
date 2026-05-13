import 'dotenv/config';
import Fastify from 'fastify';
import { loadConfig } from '../src/shared/secrets/config.js';
import { wireWebApiRoutes } from '../src/web-api/setup.js';
import { wireWebStatic } from '../src/web-static/setup.js';

/**
 * Smoke test: load config, build a Fastify instance (no listen), register
 * the web-auth routes, walk the route table to confirm /api/auth/* landed.
 *
 * Run with: pnpm tsx scripts/verify-web-auth-wires.ts
 */
async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`config loaded: NODE_ENV=${config.nodeEnv}, port=${config.port}`);

  const app = Fastify({ logger: false });
  const b = await wireWebApiRoutes(app, config);
  console.log(`wireWebApiRoutes: registered=${b.registered}, reason=${b.reason ?? 'ok'}`);
  const c = await wireWebStatic(app, config);
  console.log(`wireWebStatic  : registered=${c.registered}, reason=${c.reason ?? 'ok'}`);

  if (!b.registered) {
    console.error('FAIL: wiring did not register. Missing env vars?');
    await app.close();
    process.exit(1);
  }

  // List all routes so we can verify /api/auth/* landed.
  const routes = app.printRoutes({ includeHooks: false });
  console.log('---routes---');
  console.log(routes);

  const expected = [
    'POST /api/auth/signup',
    'POST /api/auth/login',
    'GET /api/auth/verify',
    'GET /api/auth/me',
    'POST /api/auth/logout',
  ];
  let missing = 0;
  for (const e of expected) {
    const [method, path] = e.split(' ');
    if (method === undefined || path === undefined) continue;
    // printRoutes uses a tree; just substring-match.
    const ok = routes.includes(path.replace('/api/auth/', '') ?? '');
    console.log(`  ${ok ? 'ok' : 'MISS'}: ${e}`);
    if (!ok) missing++;
  }
  await app.close();
  if (missing > 0) {
    console.error(`FAIL: ${missing} expected route(s) missing`);
    process.exit(1);
  }
  console.log('PASS: web-auth wiring verified.');
}

main().catch((err: unknown) => {
  console.error('verify failed:', err);
  process.exit(1);
});
