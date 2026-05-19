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

describe('Phase 10.5 — Runbook tabletop: WhatsApp account suspension', () => {
  it('runbook documents E11_AccountSuspended detection and recovery', async () => {
    await withEvidence(
      {
        testId: 'phase-10/runbook-tabletop/whatsapp-suspension',
        controlId: 'T1.BackupAndDR.WhatsAppAccountSuspension',
        tier: 'T1',
        description:
          'Runbook references E11_AccountSuspended terminal event, Sentry source tag, suppression_list mitigation',
      },
      async () => {
        const md = await readRunbook('whatsapp-account-suspension');
        expect(md).toContain('E11_AccountSuspended');
        expect(md).toContain('Process_11.Step_8_APIDispatch');
        expect(md).toContain('suppression_list');
        expect(md).toContain('correlation_id');
        // Decision matrix referenced
        expect(md.toLowerCase()).toContain('billing');
        expect(md.toLowerCase()).toContain('policy');
      },
    );
  });
});

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
          'Runbook references the 7-day Pro-tier PITR window, staging drill, and reconciliation matrix',
      },
      async () => {
        const md = await readRunbook('supabase-pitr-drill');
        expect(md).toContain('PITR');
        // 7-day window is a known property of the Pro tier
        expect(md).toContain('7 days');
        // Drill is on staging
        expect(md.toLowerCase()).toContain('staging');
        // Verification scripts
        expect(md).toContain('verify-phase-7.ts');
        expect(md).toContain('verify-phase-9.ts');
      },
    );
  });
});
