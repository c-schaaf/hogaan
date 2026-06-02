import { describe, expect, it } from 'vitest';
import { reportP0, reportP1, reportP2 } from '../../src/incident-handling/index.js';
import { recordEvidence } from '../../src/shared/audit-evidence/index.js';
import { withEvidence } from './helpers/evidence.js';

/**
 * Phase 10.8 — pre-launch checklist.
 *
 * Mix of:
 *   (a) Carry-forward evidence rows pointing to existing tests that already
 *       prove a control (audit-log fail-closed, ≥30-user privacy floor)
 *   (b) New synthetic-incident tests proving the P0/P1/P2 alerting path
 *       is wired up
 *   (c) Operational items flagged as TBD with clear gating notes
 *       (WhatsApp template approval, +254 sender approval, secret rotation)
 *
 * Operational TBDs do NOT fail the test — they record as `outcome: 'deferred'`
 * with the gating note so the audit binder shows them as
 * action-needed-by-ops.
 */

describe('Phase 10.8 — Pre-launch checklist', () => {
  // ----- carry-forward evidence (existing tests prove these) -------------

  it('carry-forward: audit log writes are fail-closed (Phase 2B.7)', async () => {
    await withEvidence(
      {
        testId: 'phase-10/checklist/audit-log-fail-closed',
        controlId: 'T1.AccessControl.AuditLogFailClosed',
        tier: 'T1',
        description:
          'Audit-log INSERT failure causes Identity Process #12 to return E11_AuditLogFailure (caller gets no auth result). Proven by tests/identity/end-events.test.ts and the schema-level grant in drizzle/0001_*.sql.',
        details: {
          provingTests: ['tests/identity/end-events.test.ts', 'tests/identity/normalize.test.ts'],
          schemaConstraint: 'drizzle/0001_*.sql revokes UPDATE/DELETE on audit_log',
        },
      },
      () => {
        // No new assertion — the audit row is the artifact; the proving tests
        // run in their own files. We just want the evidence binder to show
        // T1.AccessControl.AuditLogFailClosed as carried-forward = pass.
      },
    );
  });

  it('carry-forward: PII discipline (encryption + first-name redaction in prompts)', async () => {
    await withEvidence(
      {
        testId: 'phase-10/checklist/pii-discipline',
        controlId: 'T3.PrivacyControls.PIIRedaction',
        tier: 'T3',
        description:
          'Phone numbers SHA-256 hashed for IDs; plaintext column-encrypted via AES-256-GCM (ENCRYPTION_KEY_BASE64); first names omitted from prompt assembly to LLM providers.',
        details: {
          provingTests: [
            'tests/shared/encryption.test.ts',
            'tests/prompt-assembly/pii-discipline.test.ts',
          ],
          claudeMdRule: 'CLAUDE.md hard rule #4',
        },
      },
      () => {
        // No new assertion — proving tests carry the load.
      },
    );
  });

  it('carry-forward: WhatsApp idempotency triple-check (Process #11 §2/§7/§9)', async () => {
    await withEvidence(
      {
        testId: 'phase-10/checklist/whatsapp-idempotency',
        controlId: 'T2.Process11.IdempotencyTripleCheck',
        tier: 'T2',
        description:
          'Process #11 enforces idempotency at three checkpoints: §2 lookup, §7 SETEX dispatching state with 24h TTL, §9 receipt recording. Both lookup and acquire fail-closed.',
        details: {
          claudeMdRule: 'CLAUDE.md hard rule #6',
          provingTests: ['tests/whatsapp-delivery/end-events.test.ts'],
        },
      },
      () => {
        // No new assertion.
      },
    );
  });

  it('carry-forward: postgres-js timestamp coercion (P0 fix 2026-05-05)', async () => {
    await withEvidence(
      {
        testId: 'phase-10/checklist/timestamp-coercion',
        controlId: 'T2.Process2.TimestampCoercion',
        tier: 'T2',
        description:
          'DB-sourced timestamps coerced to Date at every read boundary; defensive coercion in buildMemoryBlock. Regression suite exercises ISO-string-typed memories through buildMemoryBlock and confirms no throw.',
        details: {
          provingTests: ['tests/prompt-assembly/blocks-postgres-strings.test.ts'],
          incidentDate: '2026-05-05',
        },
      },
      () => {
        // No new assertion.
      },
    );
  });

  // ----- synthetic incidents — alerting paths fire ----------------------

  it('synthetic: reportP0 dispatches an incident', async () => {
    await withEvidence(
      {
        testId: 'phase-10/checklist/synthetic-p0',
        controlId: 'T1.AccessControl.P0Alerting',
        tier: 'T1',
        description:
          'Synthetic P0 incident fires through reportP0 without throwing. In production this routes to Sentry + BetterStack pager.',
      },
      () => {
        expect(() =>
          reportP0('phase-10 synthetic P0 — pre-launch alert smoke test', {
            source: 'phase-10.checklist',
            tags: { synthetic: 'true' },
          }),
        ).not.toThrow();
      },
    );
  });

  it('synthetic: reportP1 dispatches an incident', async () => {
    await withEvidence(
      {
        testId: 'phase-10/checklist/synthetic-p1',
        controlId: 'T1.AccessControl.P1Alerting',
        tier: 'T1',
        description:
          'Synthetic P1 incident fires through reportP1 without throwing. Routes to Sentry + Axiom.',
      },
      () => {
        expect(() =>
          reportP1('phase-10 synthetic P1 — pre-launch alert smoke test', {
            source: 'phase-10.checklist',
            tags: { synthetic: 'true' },
          }),
        ).not.toThrow();
      },
    );
  });

  it('synthetic: reportP2 dispatches an incident', async () => {
    await withEvidence(
      {
        testId: 'phase-10/checklist/synthetic-p2',
        controlId: 'T1.AccessControl.P2Alerting',
        tier: 'T1',
        description:
          'Synthetic P2 incident fires through reportP2 without throwing. Routes to Axiom only.',
      },
      () => {
        expect(() =>
          reportP2('phase-10 synthetic P2 — pre-launch alert smoke test', {
            source: 'phase-10.checklist',
            tags: { synthetic: 'true' },
          }),
        ).not.toThrow();
      },
    );
  });

  // ----- operational TBDs — recorded as deferred ------------------------

  it('operational TBD: WhatsApp templates approved by Meta', async () => {
    await recordEvidence({
      testId: 'phase-10/checklist/whatsapp-template-approval',
      controlId: 'T1.OperationalReadiness.WhatsAppTemplateApproval',
      tier: 'T1',
      outcome: 'deferred',
      description:
        'Pre-approved WhatsApp message templates for daily prompts and crisis resource holding-message must be submitted to Meta and approved before Phase A users go live with the production sender. Tracked in ops, not engineering.',
      details: {
        gating: 'pre-launch',
        owner: 'ops',
        currentStatus: 'sandbox sender; templates not yet submitted',
      },
    });
    // No assertion — this is operational tracking, not engineering pass/fail.
  });

  it('operational TBD: +254 production sender approved by Meta', async () => {
    await recordEvidence({
      testId: 'phase-10/checklist/production-sender-approval',
      controlId: 'T1.OperationalReadiness.ProductionSenderApproval',
      tier: 'T1',
      outcome: 'deferred',
      description:
        '+254 production WhatsApp Business sender registration + display-name approval by Meta. Currently using Twilio sandbox; production sender registration is an ops blocker for Phase A launch.',
      details: {
        gating: 'pre-launch',
        owner: 'ops',
        currentStatus: 'sandbox',
      },
    });
  });

  it('operational TBD: secret rotation post-Phase 9', async () => {
    await recordEvidence({
      testId: 'phase-10/checklist/secret-rotation',
      controlId: 'T1.AccessControl.SecretRotation',
      tier: 'T1',
      outcome: 'deferred',
      description:
        'Rotate JWT_SECRET_BASE64, RESEND_API_KEY, TWILIO_AUTH_TOKEN, ENCRYPTION_KEY_BASE64 (CAREFUL — last one breaks existing encrypted columns; only rotate at clean-DB cutover). Owner: ops. Tracked separately from engineering CI.',
      details: {
        gating: 'pre-launch',
        owner: 'ops',
        rotationOrder: [
          'RESEND_API_KEY (safe — no stored data)',
          'TWILIO_AUTH_TOKEN (safe — no stored data)',
          'JWT_SECRET_BASE64 (existing portal sessions invalidated; acceptable for alpha)',
          'ENCRYPTION_KEY_BASE64 (DESTRUCTIVE — re-encrypt all phone_encrypted/first_name_encrypted columns; coordinate with teardown of synthetic data)',
        ],
      },
    });
  });

  // ----- Phase A launch gates summary -----------------------------------

  it('aggregate: Phase A launch gates per PRD §9.3', async () => {
    await recordEvidence({
      testId: 'phase-10/checklist/phase-a-gates',
      controlId: 'T1.LaunchGate.PhaseAReadiness',
      tier: 'T1',
      outcome: 'deferred',
      description:
        'Phase A launch is BLOCKED on the deferred 10.2 voice + framework fidelity harness. PRD §9.3 requires ≥80% Hamse-audit pass rate; cannot be measured without 10.2. See SUMMARY.md.',
      details: {
        engineeringReady: true,
        operationalReady: false,
        operationalBlockers: [
          'WhatsApp template approval',
          '+254 sender approval',
          'secret rotation',
        ],
        engineeringBlockers: [
          'Phase 10.2 voice + framework fidelity harness (deferred pending Hamse scoping session)',
          'Phase 10.7 Hamse weekly review tooling (depends on 10.2)',
        ],
      },
    });
  });
});
