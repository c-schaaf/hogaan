/**
 * `pnpm eval:coaching [--scripted]` — P0.4 coaching-quality eval.
 *
 * With ANTHROPIC_API_KEY set: runs the 40 cases against the configured chat
 * model (LLM_CHAT_MODEL, default claude-haiku-4-5) and writes a report to
 * eval/results/. This costs real money (40 short calls, roughly a few cents
 * on Haiku). Without a key, pass --scripted to exercise the harness with the
 * demo stand-in coach (proves the pipeline; the score means nothing).
 *
 * Uses the embedded database seeded with the repo's library content, so it
 * needs no Supabase project.
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { seedDemo } from '../src/demo/seed.js';
import { renderMarkdown, runEval } from '../src/eval/run.js';
import { createEmbeddedDb } from '../src/shared/db/embedded.js';
import { loadConfig } from '../src/shared/secrets/config.js';

async function main(): Promise<void> {
  const scripted = process.argv.includes('--scripted');
  if (!scripted && (process.env['ANTHROPIC_API_KEY'] ?? '') === '') {
    console.error('No ANTHROPIC_API_KEY set. Re-run with --scripted to test the harness only.');
    process.exit(1);
  }
  process.env['NODE_ENV'] ??= 'development';
  process.env['PORT'] ??= '3000';
  process.env['LOG_LEVEL'] ??= 'warn';
  process.env['ENCRYPTION_KEY_BASE64'] ??= randomBytes(32).toString('base64');
  if (scripted) {
    process.env['DEMO_MODE'] = 'true';
    delete process.env['ANTHROPIC_API_KEY'];
  }
  const config = loadConfig();
  const { db, close } = await createEmbeddedDb();
  const { userId } = await seedDemo(db, config);
  const result = await runEval(config, db, userId);
  await close();
  const dir = path.resolve('eval/results');
  mkdirSync(dir, { recursive: true });
  const stamp = result.startedAt.replace(/[:.]/g, '-');
  writeFileSync(path.join(dir, `${stamp}-${result.model}.json`), JSON.stringify(result, null, 2));
  writeFileSync(path.join(dir, `${stamp}-${result.model}.md`), renderMarkdown(result));
  console.log(
    `model=${result.model} cases=${result.summary.cases} mean=${result.summary.meanScore.toFixed(3)}`,
  );
  console.log(JSON.stringify(result.summary.byCriterion));
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
