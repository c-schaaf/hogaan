// Drift-guard for RLS migration coverage. Today the app role is granted
// BYPASSRLS (see drizzle/0013_rls_baseline.sql) so these policies do not
// gate live traffic — they're staged for when the connection role is
// tightened (per-user role or `SET LOCAL app.user_id`). This test pins the
// coverage so that day-one tightening doesn't quietly miss a new table.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const drizzleDir = path.join(repoRoot, 'drizzle');
const schemaDir = path.join(repoRoot, 'src', 'shared', 'db', 'schema');

/**
 * Documented exclusions from drizzle/0013_rls_baseline.sql:
 *   - audit_log: append-only by the app; only INSERT is granted on the
 *     application role and CLAUDE.md hard rule #4 makes the writer
 *     fail-closed. Per-user policy adds no defence today.
 *   - prompt_logs: aggregate / replay log, not surfaced to end users.
 *
 * If we ever expose either of these to a per-user reader, drop the entry
 * here and add the corresponding ALTER TABLE ... ENABLE ROW LEVEL SECURITY
 * to a new migration.
 */
const BASELINE_RLS_TABLES = ['memories', 'sessions', 'turns', 'users'];
const CONTEXT_BUILD_RLS_TABLES = [
  'background_jobs',
  'leader_briefs',
  // 0019
  'email_sends',
  'moment_outcomes',
  'moments',
  'notification_prefs',
  'turn_ratings',
  // 0020
  'mcp_tokens',
  // 0021
  'billing_events',
  'subscriptions',
  // 0022
  'cohort_invites',
  'cohort_members',
  'cohorts',
  'org_admins',
  'organizations',
];

const DOCUMENTED_RLS_EXCLUSIONS = new Set<string>(['audit_log', 'prompt_logs']);

async function readSqlFiles(): Promise<string[]> {
  const entries = await readdir(drizzleDir, { withFileTypes: true });
  const sqlNames = entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort();
  return Promise.all(sqlNames.map((n) => readFile(path.join(drizzleDir, n), 'utf8')));
}

async function readSchemaFiles(): Promise<Array<{ file: string; source: string }>> {
  const entries = await readdir(schemaDir, { withFileTypes: true });
  const tsNames = entries
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
    .map((e) => e.name)
    .sort();
  return Promise.all(
    tsNames.map(async (n) => ({
      file: n,
      source: await readFile(path.join(schemaDir, n), 'utf8'),
    })),
  );
}

function collectRlsEnabledTables(sqlSources: readonly string[]): Set<string> {
  // ALTER TABLE "public"."<name>" ENABLE ROW LEVEL SECURITY;
  // Also tolerate unquoted or schema-less variants in case future migrations
  // drift on formatting.
  const re =
    /ALTER\s+TABLE\s+(?:"public"\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
  const out = new Set<string>();
  for (const sql of sqlSources) {
    for (const m of sql.matchAll(re)) {
      const name = m[1];
      if (name !== undefined) {
        out.add(name);
      }
    }
  }
  return out;
}

function collectPgTableNames(source: string): string[] {
  // export const xxx = pgTable('<sqlName>', ...)
  const re = /pgTable\s*\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g;
  const out: string[] = [];
  for (const m of source.matchAll(re)) {
    const name = m[1];
    if (name !== undefined) {
      out.push(name);
    }
  }
  return out;
}

function hasUserKeyColumn(source: string): boolean {
  // Convention (confirmed against sessions.ts, turns.ts, memories.ts,
  // audit-log.ts, prompt-logs.ts): user-keyed tables declare a
  // `userId: uuid('user_id')...` column. Match the SQL column literal so
  // a TS-side rename can't drift past the guard.
  return /['"]user_id['"]/.test(source);
}

describe('drizzle RLS migration coverage', () => {
  it('every user-keyed schema table has RLS enabled (or is a documented exclusion)', async () => {
    const [sqlSources, schemaFiles] = await Promise.all([readSqlFiles(), readSchemaFiles()]);
    const rlsEnabled = collectRlsEnabledTables(sqlSources);

    const userKeyedTables: string[] = [];
    for (const { file, source } of schemaFiles) {
      if (!hasUserKeyColumn(source)) continue;
      const names = collectPgTableNames(source);
      expect(names, `expected ${file} to declare at least one pgTable`).not.toHaveLength(0);
      userKeyedTables.push(...names);
    }

    expect(
      userKeyedTables.length,
      'no user-keyed tables discovered — schema parse drift',
    ).toBeGreaterThan(0);

    const missing = userKeyedTables.filter(
      (t) => !rlsEnabled.has(t) && !DOCUMENTED_RLS_EXCLUSIONS.has(t),
    );
    expect(missing, `user-keyed tables without RLS coverage: ${missing.join(', ')}`).toEqual([]);
  });

  it('documented RLS exclusions are still genuinely user-keyed (otherwise drop them)', async () => {
    const schemaFiles = await readSchemaFiles();
    const userKeyed = new Set<string>();
    for (const { source } of schemaFiles) {
      if (!hasUserKeyColumn(source)) continue;
      for (const name of collectPgTableNames(source)) {
        userKeyed.add(name);
      }
    }
    const stale = [...DOCUMENTED_RLS_EXCLUSIONS].filter((t) => !userKeyed.has(t));
    expect(stale, `exclusion list references non-user-keyed tables: ${stale.join(', ')}`).toEqual(
      [],
    );
  });

  it('documented RLS exclusions are not silently double-covered by a migration', async () => {
    const sqlSources = await readSqlFiles();
    const rlsEnabled = collectRlsEnabledTables(sqlSources);
    const overlap = [...DOCUMENTED_RLS_EXCLUSIONS].filter((t) => rlsEnabled.has(t));
    expect(
      overlap,
      `exclusion list duplicates a migration; drop these entries: ${overlap.join(', ')}`,
    ).toEqual([]);
  });

  it('RLS-enabled table set matches the baseline migration (regression pin)', async () => {
    const sqlSources = await readSqlFiles();
    const rlsEnabled = collectRlsEnabledTables(sqlSources);
    // Context-and-connections build: each phase that adds a table adds it
    // here deliberately (0018 = leader_briefs + background_jobs, …).
    expect([...rlsEnabled].sort()).toEqual(
      [...BASELINE_RLS_TABLES, ...CONTEXT_BUILD_RLS_TABLES].sort(),
    );
  });
});
