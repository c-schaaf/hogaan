/**
 * `pnpm demo` — one command to try Hogaan with no accounts or services.
 *
 *   1. Refuses to run if NODE_ENV=production.
 *   2. Builds the web app in demo mode into dist/web-demo.
 *   3. Starts the server with an embedded database, seeded sample leader,
 *      and the scripted coach (or the real model if ANTHROPIC_API_KEY is set).
 *
 * Then open http://localhost:3000 (or the PORT you set).
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { assertDemoAllowed, startDemoServer } from '../src/demo/server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  try {
    assertDemoAllowed(process.env);
  } catch (err) {
    console.error(`[demo] ${(err as Error).message}`);
    process.exit(1);
  }
  const outDir = path.join(root, 'dist', 'web-demo');
  if (process.env['DEMO_SKIP_WEB_BUILD'] !== 'true') {
    console.log('[demo] building the web app in demo mode…');
    process.env['VITE_DEMO_MODE'] = 'true';
    // Vite sets NODE_ENV=production inside this process while it builds.
    // Restore the caller's value so the server-side production guard below
    // judges the real environment, not Vite's build-time setting.
    const callerNodeEnv = process.env['NODE_ENV'];
    await build({
      configFile: path.join(root, 'web', 'vite.config.ts'),
      logLevel: 'warn',
      build: { outDir, emptyOutDir: true, sourcemap: false },
    });
    if (callerNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = callerNodeEnv;
  }
  const server = await startDemoServer({ webDistDir: outDir });
  const model =
    server.config.anthropicApiKey !== undefined
      ? `real model (${server.config.llmChatModel ?? 'claude-haiku-4-5'})`
      : 'scripted stand-in coach (no ANTHROPIC_API_KEY set)';
  console.log('');
  console.log('  Hogaan demo is running.');
  console.log(`  Open:  http://localhost:${server.config.port}`);
  console.log('  You are signed in as the sample leader "Amina". Nothing is saved after you stop.');
  console.log(`  Coach: ${model}`);
  console.log('  Stop:  Ctrl+C');
  console.log('');
  const stop = () => {
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

void main().catch((err: unknown) => {
  console.error('[demo] failed to start', err);
  process.exit(1);
});
