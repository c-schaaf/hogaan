import { describe, expect, it, vi } from 'vitest';
import { resolveIdentity } from '../../src/identity/orchestrator.js';
import { hashPhone } from '../../src/shared/db/encryption.js';
import { withEvidence } from './helpers/evidence.js';
import { fakeConfig, fakeRedis } from './helpers/fakes.js';

/**
 * Phase 10.1 BPMN coverage — Process #12 (Identity).
 * Closes 2 gaps: E6_BlockedUser, E9_WebSessionInvalid.
 *
 * resolveIdentity() is the entry-point chokepoint for every inbound user
 * message. We drive it directly with realistic IdentityRequest payloads.
 *
 * Lookup-and-route DB calls (lookupAndRoute) are mocked to a no-op for
 * the E6 path because suppression check fires BEFORE lookup. For E9
 * (web_session path) the lookup is bypassed entirely.
 *
 * The fail-closed audit log write at Step 8 IS exercised: we mock
 * writeAuditEntry to succeed and assert it was called with the
 * correct end event. This proves the process emits an audit row
 * before returning the terminal event (CLAUDE.md hard rule #4).
 */

vi.mock('../../src/identity/lookup.js', () => ({
  lookupAndRoute: vi.fn(),
  AdvisoryLockTimeoutError: class extends Error {},
  LookupServiceUnavailableError: class extends Error {},
}));

vi.mock('../../src/identity/audit.js', () => ({
  writeAuditEntry: vi.fn(() => Promise.resolve()),
}));

const stubDb = {} as unknown as Parameters<typeof resolveIdentity>[0]['db'];
const stubSql = {} as unknown as Parameters<typeof resolveIdentity>[0]['sql'];

describe('Phase 10.1 — Process #12 (Identity) end-event coverage', () => {
  it('E6_BlockedUser fires when phone hash is in the block set', async () => {
    await withEvidence(
      {
        testId: 'phase-10/bpmn-coverage/process-12/e6-blocked-user',
        controlId: 'T2.Process12.E6_BlockedUser',
        tier: 'T2',
        description:
          'Identity orchestrator returns E6_BlockedUser when the inbound phone is on the block list. Suppression check at Step 3 short-circuits before lookup. Audit row is written at Step 8 with the E6 endEvent.',
      },
      async () => {
        const redis = fakeRedis();
        const phone = '+254700099991';
        redis.block(hashPhone(phone));

        const audit = await import('../../src/identity/audit.js');
        const writeSpy = vi.mocked(audit.writeAuditEntry);
        writeSpy.mockClear();

        const result = await resolveIdentity(
          {
            config: fakeConfig(),
            sql: stubSql,
            db: stubDb,
            redis,
          },
          {
            requestId: 'req-blocked-user-test',
            triggerSource: 'whatsapp',
            phoneNumber: phone,
            inboundMessageId: 'MM-test-blocked',
          },
        );

        expect(result.endEvent).toBe('E6_BlockedUser');
        // Audit row written before the orchestrator returns (Step 8 fail-closed).
        expect(writeSpy).toHaveBeenCalledTimes(1);
        const auditEntry = writeSpy.mock.calls[0]![1];
        expect(auditEntry.endEvent).toBe('E6_BlockedUser');
        expect(auditEntry.phoneHash).toBe(hashPhone(phone));
        expect(auditEntry.triggerSource).toBe('whatsapp');
        // No PII other than phone hash.
        expect((auditEntry as unknown as Record<string, unknown>)['phoneNumber']).toBeUndefined();
      },
    );
  });

  it('E9_WebSessionInvalid fires when web_session sessionToken is malformed JWT', async () => {
    await withEvidence(
      {
        testId: 'phase-10/bpmn-coverage/process-12/e9-web-session-invalid',
        controlId: 'T2.Process12.E9_WebSessionInvalid',
        tier: 'T2',
        description:
          'Identity orchestrator returns E9_WebSessionInvalid when the web_session token is malformed / expired / signature-invalid. The token path bypasses the phone path; lookup is not called.',
      },
      async () => {
        const redis = fakeRedis();

        const audit = await import('../../src/identity/audit.js');
        const writeSpy = vi.mocked(audit.writeAuditEntry);
        writeSpy.mockClear();

        const result = await resolveIdentity(
          {
            config: fakeConfig(),
            sql: stubSql,
            db: stubDb,
            redis,
          },
          {
            requestId: 'req-web-session-invalid-test',
            triggerSource: 'web_session',
            sessionToken: 'not.a.valid.jwt.payload',
            originatingIp: '198.51.100.42',
          },
        );

        expect(result.endEvent).toBe('E9_WebSessionInvalid');
        expect(writeSpy).toHaveBeenCalledTimes(1);
        const auditEntry = writeSpy.mock.calls[0]![1];
        expect(auditEntry.endEvent).toBe('E9_WebSessionInvalid');
        expect(auditEntry.triggerSource).toBe('web_session');
      },
    );
  });

  it('E9_WebSessionInvalid fires for a token signed with a different secret', async () => {
    await withEvidence(
      {
        testId: 'phase-10/bpmn-coverage/process-12/e9-wrong-secret',
        controlId: 'T2.Process12.E9_WebSessionInvalid',
        tier: 'T2',
        description:
          'Cross-secret signature: a token signed by a different JWT secret is rejected as E9_WebSessionInvalid (signature verification fails)',
      },
      async () => {
        const { issueSessionToken, resetTokenCacheForTests } =
          await import('../../src/identity/token.js');
        const { asUserId } = await import('../../src/shared/types/index.js');

        // Issue a token with secret A.
        resetTokenCacheForTests();
        const cfgA = fakeConfig({ jwtSecretBase64: 'A'.repeat(64) });
        const token = await issueSessionToken(cfgA, {
          userId: asUserId('u-1'),
          jti: 'jti-cross-secret',
          ttlSeconds: 60,
        });

        // Validate it under a different secret B (orchestrator config).
        resetTokenCacheForTests();
        const audit = await import('../../src/identity/audit.js');
        const writeSpy = vi.mocked(audit.writeAuditEntry);
        writeSpy.mockClear();

        const result = await resolveIdentity(
          {
            config: fakeConfig({ jwtSecretBase64: 'B'.repeat(64) }),
            sql: stubSql,
            db: stubDb,
            redis: fakeRedis(),
          },
          {
            requestId: 'req-wrong-secret',
            triggerSource: 'web_session',
            sessionToken: token,
            originatingIp: '203.0.113.99',
          },
        );

        expect(result.endEvent).toBe('E9_WebSessionInvalid');
        expect(writeSpy).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ endEvent: 'E9_WebSessionInvalid' }),
        );
      },
    );
  });
});
