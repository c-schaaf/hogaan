import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb, type Database } from '../src/shared/db/client.js';
import { auditLog } from '../src/shared/db/schema/audit-log.js';
import { memories } from '../src/shared/db/schema/memories.js';
import { promptLogs } from '../src/shared/db/schema/prompt-logs.js';
import { sessions } from '../src/shared/db/schema/sessions.js';
import { turns } from '../src/shared/db/schema/turns.js';
import { users } from '../src/shared/db/schema/users.js';
import { loadConfig } from '../src/shared/secrets/config.js';

/**
 * Pre-launch test-data wipe. Truncates the user-data spine of the prod
 * database in a single transaction so partial state is impossible.
 *
 *   pnpm exec tsx scripts/wipe-test-data.ts             # dry run
 *   pnpm exec tsx scripts/wipe-test-data.ts --confirm   # actually delete
 *
 * Guards:
 *   - Without --confirm the script prints before-counts and exits 0.
 *   - When NODE_ENV !== 'production' the script refuses unless
 *     --force-non-prod is also passed (the most common operator mistake
 *     is pointing at the wrong DB).
 *
 * Tables wiped (FK-respecting order):
 *   prompt_logs → audit_log → memories → turns → sessions → users
 *
 * Preserved (seeded or independent reference data):
 *   library_versions.
 *
 * Caveat — audit_log: prod revokes UPDATE / DELETE on this table from the
 * application role (see src/shared/db/schema/audit-log.ts). The wipe will
 * surface a permission error when the role is correctly locked down. A
 * privileged operator must run the script (or pre-truncate audit_log via
 * a separate DBA session) for the launch wipe.
 */

const TABLE_ORDER = [
  { name: 'prompt_logs', table: promptLogs },
  { name: 'audit_log', table: auditLog },
  { name: 'memories', table: memories },
  { name: 'turns', table: turns },
  { name: 'sessions', table: sessions },
  { name: 'users', table: users },
] as const;

export interface WipeOptions {
  confirm: boolean;
  forceNonProd: boolean;
  nodeEnv: string;
}

export interface WipeIO {
  log: (line: string) => void;
  error: (line: string) => void;
}

export function parseArgs(argv: readonly string[]): { confirm: boolean; forceNonProd: boolean } {
  return {
    confirm: argv.includes('--confirm'),
    forceNonProd: argv.includes('--force-non-prod'),
  };
}

/**
 * Core wipe logic. Pulled into an exported function so tests can drive it
 * with a mocked Drizzle db.
 */
export async function runWipe(db: Database, opts: WipeOptions, io: WipeIO): Promise<number> {
  if (opts.nodeEnv !== 'production' && !opts.forceNonProd) {
    io.error(`NODE_ENV=${opts.nodeEnv} but --force-non-prod was not supplied. Refusing to run.`);
    return 1;
  }

  const before: Record<string, number> = {};
  for (const { name, table } of TABLE_ORDER) {
    const rows = await db.select({ count: sql<number>`count(*)::int` }).from(table);
    before[name] = rows[0]?.count ?? 0;
  }

  io.log('=== wipe-test-data ===');
  io.log(`NODE_ENV: ${opts.nodeEnv}`);
  io.log(`mode: ${opts.confirm ? 'CONFIRM (will delete)' : 'dry-run (no deletes)'}`);
  io.log('row counts BEFORE:');
  for (const { name } of TABLE_ORDER) {
    io.log(`  ${name.padEnd(16)} ${before[name]}`);
  }

  if (!opts.confirm) {
    io.log('');
    io.log('Dry run complete — re-run with --confirm to actually delete.');
    return 0;
  }

  await db.transaction(async (tx) => {
    for (const { name, table } of TABLE_ORDER) {
      io.log(`deleting ${name}…`);
      await tx.delete(table);
    }
  });

  io.log('row counts AFTER:');
  for (const { name, table } of TABLE_ORDER) {
    const rows = await db.select({ count: sql<number>`count(*)::int` }).from(table);
    io.log(`  ${name.padEnd(16)} ${rows[0]?.count ?? 0}`);
  }
  io.log('wipe complete.');
  return 0;
}

async function main(): Promise<void> {
  const { confirm, forceNonProd } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const { db, close } = getDb(config);
  const io: WipeIO = {
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  };

  try {
    const exitCode = await runWipe(db, { confirm, forceNonProd, nodeEnv: config.nodeEnv }, io);
    process.exit(exitCode);
  } finally {
    await close();
  }
}

// Only invoke `main` when run as a script (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  main().catch((err: unknown) => {
    console.error('wipe-test-data fatal:', err);
    process.exit(1);
  });
}
