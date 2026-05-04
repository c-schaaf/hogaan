import type { Database } from '../shared/db/client.js';
import { auditLog } from '../shared/db/schema/audit-log.js';
import { reportIncident } from '../shared/observability/incidents.js';
import type { UserId } from '../shared/types/index.js';
import { AuditLogFailureError } from './types.js';
import type { IdentityEndEvent } from './end-events.js';
import type { TriggerSource } from './types.js';

export interface AuditEntry {
  requestId: string;
  triggerSource: TriggerSource;
  /** Hashed phone (never plaintext). Optional because token-path resolutions don't have a phone. */
  phoneHash?: string;
  userId?: UserId;
  endEvent: IdentityEndEvent;
  ipAddress?: string;
  /** Sanitized errors only — never PII. */
  inputErrors?: Record<string, unknown>;
}

/**
 * Process #12 Step 8 — fail-closed audit-log write.
 *
 * **Contract (CLAUDE.md hard rule #4):** if this throws, the caller MUST treat
 * it as a hard failure and return NO authentication result to its own caller.
 * `resolveIdentity()` enforces this by raising AuditLogFailureError, which
 * does NOT carry a userId and SHOULD NOT be treated as an authenticated state.
 *
 * Side effect: emits a Sentry P0 on failure. This is the most operationally
 * sensitive write in the system; on-call should be paged immediately.
 */
export async function writeAuditEntry(db: Database, entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      requestId: entry.requestId,
      triggerSource: entry.triggerSource,
      ...(entry.phoneHash !== undefined ? { phoneHash: entry.phoneHash } : {}),
      ...(entry.userId !== undefined ? { userId: entry.userId } : {}),
      targetEndEvent: entry.endEvent,
      ...(entry.ipAddress !== undefined ? { ipAddress: entry.ipAddress } : {}),
      ...(entry.inputErrors !== undefined ? { inputErrors: entry.inputErrors } : {}),
    });
  } catch (err) {
    reportIncident(
      'P0',
      'identity audit-log write failed — caller will receive E11 (no auth result)',
      {
        source: 'Process_12.Step_8_AuditLog',
        tags: {
          trigger_source: entry.triggerSource,
          end_event: entry.endEvent,
        },
        extra: {
          requestId: entry.requestId,
          // phoneHash is non-PII (one-way hash); safe in incident extras.
          ...(entry.phoneHash !== undefined ? { phoneHash: entry.phoneHash } : {}),
        },
      },
      err,
    );
    throw new AuditLogFailureError(entry.requestId, err);
  }
}
