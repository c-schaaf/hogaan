import { describe, expect, it, vi } from 'vitest';
import { writeAuditEntry, type AuditEntry } from '../../src/identity/audit.js';
import { AuditLogFailureError } from '../../src/identity/types.js';
import type { Database } from '../../src/shared/db/client.js';
import type { UserId } from '../../src/shared/types/index.js';

/**
 * Phase 11 R19 — lock the fail-closed audit-log contract with tests so
 * future refactors cannot accidentally weaken CLAUDE.md hard rule #4.
 *
 * Contract (Process #12 §8):
 *   1. If `db.insert(auditLog).values(...)` throws/rejects, writeAuditEntry
 *      MUST throw AuditLogFailureError. Returning silently or swallowing the
 *      error gives the caller a false sense of authentication state.
 *   2. AuditLogFailureError MUST carry the requestId so on-call can
 *      correlate logs.
 *   3. The original cause MUST be attached so Sentry breadcrumbs preserve
 *      the underlying DB error type/message.
 */

function fakeDbThatRejects(err: Error): Database {
  return {
    insert: () => ({
      values: () => Promise.reject(err),
    }),
  } as unknown as Database;
}

function fakeDbThatThrowsSync(err: Error): Database {
  return {
    insert: () => {
      throw err;
    },
  } as unknown as Database;
}

const sampleEntry: AuditEntry = {
  requestId: 'req-fail-closed-001',
  triggerSource: 'whatsapp',
  endEvent: 'E1_ExistingUserAuthenticated',
  phoneHash: 'a'.repeat(64),
  userId: 'user-1' as UserId,
};

describe('Phase 11 R19 — audit-log fail-closed contract', () => {
  it('rethrows AuditLogFailureError when the DB insert rejects', async () => {
    const cause = new Error('connection terminated unexpectedly');
    const db = fakeDbThatRejects(cause);

    await expect(writeAuditEntry(db, sampleEntry)).rejects.toBeInstanceOf(AuditLogFailureError);
  });

  it('rethrows AuditLogFailureError when the DB insert throws synchronously', async () => {
    const cause = new TypeError('connection pool drained');
    const db = fakeDbThatThrowsSync(cause);

    await expect(writeAuditEntry(db, sampleEntry)).rejects.toBeInstanceOf(AuditLogFailureError);
  });

  it('AuditLogFailureError carries requestId and original cause for on-call triage', async () => {
    const cause = new Error('relation "audit_log" does not exist');
    const db = fakeDbThatRejects(cause);

    let captured: unknown;
    try {
      await writeAuditEntry(db, sampleEntry);
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(AuditLogFailureError);
    const wrapped = captured as AuditLogFailureError & { cause?: unknown };
    expect(wrapped.requestId).toBe('req-fail-closed-001');
    expect(wrapped.cause).toBe(cause);
    expect(wrapped.endEvent).toBe('E11_AuditLogFailure');
  });

  it('does NOT swallow errors silently — caller MUST observe a throw', async () => {
    // Defensive regression test: verifies writeAuditEntry never returns
    // normally on a DB failure. A future refactor that catches the error
    // and returns void would silently re-introduce the audit gap that
    // CLAUDE.md hard rule #4 prohibits.
    const db = fakeDbThatRejects(new Error('network partition'));

    let returnedNormally = false;
    try {
      await writeAuditEntry(db, sampleEntry);
      returnedNormally = true;
    } catch {
      // expected
    }

    expect(returnedNormally).toBe(false);
  });

  it('emits a Sentry P0 incident before throwing (auditable on-call signal)', async () => {
    const incidentsModule = await import('../../src/shared/observability/incidents.js');
    const spy = vi.spyOn(incidentsModule, 'reportIncident');

    const db = fakeDbThatRejects(new Error('disk full'));
    try {
      await writeAuditEntry(db, sampleEntry);
    } catch {
      // expected
    }

    expect(spy).toHaveBeenCalledOnce();
    const call = spy.mock.calls[0]!;
    expect(call[0]).toBe('P0');
    expect(call[1]).toMatch(/audit-log write failed/);

    spy.mockRestore();
  });
});
