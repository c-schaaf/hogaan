import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withEvidence } from './helpers/evidence.js';

/**
 * Phase 10.5 — runbook tabletop drills.
 *
 * Each test walks through one runbook's documented procedure and asserts
 * that the runbook's referenced steps point at things that actually
 * exist in the codebase: commands, env vars, scripts, end-event names,
 * SQL helpers. If a runbook drifts (a script renamed, an end-event
 * removed), the tabletop fails fast — well before someone reaches for
 * the runbook in a P0.
 *
 * NOT a replacement for live drills (especially the PITR drill, which
 * must run against staging quarterly). Tabletop is just the
 * machine-verifiable subset.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNBOOKS_DIR = path.join(REPO_ROOT, 'docs', 'runbooks');

async function readRunbook(name: string): Promise<string> {
  return readFile(path.join(RUNBOOKS_DIR, `${name}.md`), 'utf8');
}

describe('Phase 10.5 — Runbook tabletop: Render outage failover', () => {
  it('runbook documents the env vars + scripts needed to stand up Railway standby', async () => {
    await withEvidence(
      {
        testId: 'phase-10/runbook-tabletop/render-failover',
        controlId: 'T1.BackupAndDR.RenderOutageFailover',
        tier: 'T1',
        description:
          'Runbook references DATABASE_URL, ENCRYPTION_KEY_BASE64, JWT_SECRET_BASE64, SPONSOR_PORTAL_BASE_URL, verify scripts',
      },
      async () => {
        const md = await readRunbook('render-outage-failover');
        // Critical env vars that MUST be ported across hosts.
        expect(md).toContain('DATABASE_URL');
        expect(md).toContain('UPSTASH_REDIS_REST_URL');
        expect(md).toContain('ENCRYPTION_KEY_BASE64');
        expect(md).toContain('JWT_SECRET_BASE64');
        expect(md).toContain('SPONSOR_PORTAL_BASE_URL');
        expect(md).toContain('TWILIO_');
        // Verification commands
        expect(md).toContain('verify-phase-7.ts');
        expect(md).toContain('verify-phase-9.ts');
        // DNS cutover step
        expect(md.toLowerCase()).toContain('twilio webhook');
      },
    );
  });
});

describe('Phase 10.5 — Runbook tabletop: Supabase PITR drill', () => {
  it('runbook documents the staging-drill procedure and the prod-incident decision matrix', async () => {
    await withEvidence(
      {
        testId: 'phase-10/runbook-tabletop/supabase-pitr',
        controlId: 'T1.BackupAndDR.SupabasePITRDrill',
        tier: 'T1',
        description:
          'Runbook references the 7-day Pro-tier PITR window, current-schema tables, the real incident decision matrix, and current real URLs',
      },
      async () => {
        const md = await readRunbook('supabase-pitr-drill');

        // Structural invariants that survive any rewrite — these are
        // properties of the system itself, not a snapshot of phrasing.
        expect(md).toContain('PITR');
        expect(md).toContain('7 days'); // Pro-tier window
        expect(md.toLowerCase()).toContain('staging');

        // SCRUM-F12: the runbook MUST reference current-schema tables only.
        // Pre-rewrite the runbook talked about phone_hash and
        // whatsapp_messages — both dropped in drizzle/0009. A drift back
        // to those names means the runbook is out of sync with the code.
        expect(md).toContain('users');
        expect(md).toContain('sessions');
        expect(md).toContain('turns');
        expect(md).not.toMatch(/phone_hash/);
        expect(md).not.toMatch(/whatsapp_messages/);
        expect(md).not.toMatch(/Twilio/i);

        // Real URLs inlined (same discipline as the F11 observability
        // runbook rewrite) — a placeholder like `[Supabase URL]` is a
        // 3am footgun.
        expect(md).toContain('supabase.com/dashboard');
        expect(md).toContain('dashboard.render.com');

        // Decision matrix for the cutover step must still exist — it's
        // the load-bearing call ("accept loss vs. replay") and the
        // single hardest moment of a real incident.
        expect(md.toLowerCase()).toContain('decision matrix');

        // Honesty: the runbook acknowledges it has not been live-drilled
        // yet (F12 Part 2). When the first drill happens, this assertion
        // gets relaxed in the same PR that removes the disclaimer.
        expect(md.toLowerCase()).toContain('not been live-drilled');
      },
    );
  });
});
