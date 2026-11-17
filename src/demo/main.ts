/**
 * Compiled entry for a HOSTED demo: `node dist/demo/main.js`.
 *
 * `pnpm demo` (scripts/demo.ts) is for your own computer: it runs through
 * tsx and builds the web app on start, which costs about 1 GB of memory.
 * A small host cannot afford that, so there the server is compiled first
 * (`pnpm build:api`), the web app is built ahead of time (`pnpm demo:build`),
 * and this file starts it directly.
 *
 * All the demo rules still apply (see ./server.ts): it refuses to run as
 * production or staging, and a hosted demo needs DEMO_ACCESS_CODE.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DemoRefusedError, startDemoServer } from './server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function main(): Promise<void> {
  const server = await startDemoServer({ webDistDir: path.join(root, 'dist', 'web-demo') });
  const coach =
    server.config.anthropicApiKey !== undefined
      ? `real model, capped at ${server.config.demoDailyModelCalls ?? 200} calls a day`
      : 'scripted stand-in (no ANTHROPIC_API_KEY set)';
  console.log(`[demo] listening on port ${server.config.port}; coach: ${coach}`);
  const stop = () => {
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

void main().catch((err: unknown) => {
  if (err instanceof DemoRefusedError) console.error(`[demo] ${err.message}`);
  else console.error('[demo] failed to start', err);
  process.exit(1);
});
