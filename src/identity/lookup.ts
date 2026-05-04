import type { Database, SqlClient } from '../shared/db/client.js';
import { withAdvisoryLock, AdvisoryLockTimeoutError } from '../shared/db/lock.js';
import { encryptPlaintext } from '../shared/db/encryption.js';
import { users } from '../shared/db/schema/users.js';
import { eq } from 'drizzle-orm';
import { asUserId, type UserId } from '../shared/types/index.js';
import type { AppConfig } from '../shared/secrets/config.js';

export type RouteDecision =
  | { kind: 'existing_onboarded'; userId: UserId; status: 'onboarded'; lastCompletedStep: number }
  | { kind: 'duplicate_signup'; userId: UserId; lastCompletedStep: number }
  | {
      kind: 'resume_onboarding';
      userId: UserId;
      status: 'onboarding_started' | 'onboarding_dormant' | 'provisional';
      lastCompletedStep: number;
    }
  | { kind: 'new_user'; userId: UserId };

export type TriggerForRouting = 'whatsapp' | 'web_signup';

export class LookupServiceUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'LookupServiceUnavailableError';
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Process #12 Steps 4–6: lookup-and-lock + routing decision + provisional create.
 *
 * Concurrency: a transactional advisory lock keyed on phone hash serializes
 * concurrent requests for the same user. The 2s wait timeout is from the BPMN.
 *
 * Race handling: even with the lock, a UNIQUE constraint on phone_hash catches
 * the edge case where another process holds the lock, inserts, releases, and
 * we proceed. On unique-constraint violation we re-read the now-existing row
 * and re-route.
 *
 * Re-export AdvisoryLockTimeoutError so the orchestrator can map to E8.
 */
export async function lookupAndRoute(
  config: AppConfig,
  sql: SqlClient,
  db: Database,
  phoneHash: string,
  phoneE164: string,
  triggerSource: TriggerForRouting,
): Promise<RouteDecision> {
  try {
    return await withAdvisoryLock(sql, `identity:${phoneHash}`, 2000, async () => {
      let user = await selectByPhoneHash(db, phoneHash);

      if (user === null) {
        // Step 6: insert provisional. If race fires between lock release and
        // our INSERT (rare but the BPMN calls it out), the UNIQUE constraint
        // catches it and we re-read.
        try {
          user = await insertProvisional(config, db, phoneHash, phoneE164);
        } catch (err) {
          if (isUniqueViolation(err)) {
            user = await selectByPhoneHash(db, phoneHash);
            if (user === null) {
              throw new LookupServiceUnavailableError(
                'phone_hash unique race resolved to null on re-read',
              );
            }
          } else {
            throw err;
          }
        }
      }

      return decideRoute(user, triggerSource);
    });
  } catch (err) {
    if (err instanceof AdvisoryLockTimeoutError) {
      throw err; // Orchestrator maps to E8.
    }
    if (err instanceof LookupServiceUnavailableError) {
      throw err;
    }
    throw new LookupServiceUnavailableError(
      `identity lookup failed: ${(err as Error).message}`,
      err,
    );
  }
}

interface UserRow {
  id: string;
  status:
    | 'provisional'
    | 'onboarding_started'
    | 'onboarding_dormant'
    | 'onboarded'
    | 'consent_declined'
    | 'opted_out'
    | 'blocked'
    | 'onboarding_error';
  lastCompletedStep: number;
}

async function selectByPhoneHash(db: Database, phoneHash: string): Promise<UserRow | null> {
  const rows = await db
    .select({
      id: users.id,
      status: users.status,
      lastCompletedStep: users.lastCompletedStep,
    })
    .from(users)
    .where(eq(users.phoneHash, phoneHash))
    .limit(1);
  return rows[0] ?? null;
}

async function insertProvisional(
  config: AppConfig,
  db: Database,
  phoneHash: string,
  phoneE164: string,
): Promise<UserRow> {
  const phoneEncrypted = encryptPlaintext(config, phoneE164);
  const inserted = await db
    .insert(users)
    .values({
      phoneHash,
      phoneEncrypted,
      status: 'provisional',
    })
    .returning({
      id: users.id,
      status: users.status,
      lastCompletedStep: users.lastCompletedStep,
    });
  if (inserted[0] === undefined) {
    throw new LookupServiceUnavailableError('insert provisional returned no row');
  }
  return inserted[0];
}

function isUniqueViolation(err: unknown): boolean {
  if (err === null || typeof err !== 'object') {
    return false;
  }
  return (err as { code?: unknown }).code === '23505';
}

function decideRoute(user: UserRow, triggerSource: TriggerForRouting): RouteDecision {
  // Process #12 Step 5 routing decision table.
  if (user.status === 'onboarded') {
    if (triggerSource === 'web_signup') {
      return {
        kind: 'duplicate_signup',
        userId: asUserId(user.id),
        lastCompletedStep: user.lastCompletedStep,
      };
    }
    return {
      kind: 'existing_onboarded',
      userId: asUserId(user.id),
      status: 'onboarded',
      lastCompletedStep: user.lastCompletedStep,
    };
  }

  if (
    user.status === 'onboarding_started' ||
    user.status === 'onboarding_dormant' ||
    user.status === 'provisional'
  ) {
    return {
      kind: 'resume_onboarding',
      userId: asUserId(user.id),
      status: user.status,
      lastCompletedStep: user.lastCompletedStep,
    };
  }

  // consent_declined / opted_out / blocked / onboarding_error: terminal states.
  // Treat as "new" path is wrong — for blocked/opted_out the suppression check
  // upstream should have caught them. For consent_declined / onboarding_error
  // we return existing-onboarded-shaped failure; orchestrator routes to E1
  // since the user record exists, and the upstream consumer (Coaching) decides
  // what to do given status.
  return {
    kind: 'existing_onboarded',
    userId: asUserId(user.id),
    status: 'onboarded',
    lastCompletedStep: user.lastCompletedStep,
  };
}

export { AdvisoryLockTimeoutError };
