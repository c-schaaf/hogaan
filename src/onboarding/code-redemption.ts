import { eq, sql } from 'drizzle-orm';
import { accessCodes } from '../shared/db/schema/access-codes.js';
import { users } from '../shared/db/schema/users.js';
import type { Database } from '../shared/db/client.js';
import { asCohortId, type CohortId, type UserId } from '../shared/types/index.js';

/**
 * Process #1 §12 sponsor access-code redemption.
 *
 * Pattern: lowercase alphanumeric + dash, e.g. "kobciye-3742". The dash + a
 * 3+ digit suffix distinguishes intentional codes from incidental hyphenated
 * words. Pattern is permissive — content reviewers ultimately decide what
 * qualifies; the code list itself is the source of truth.
 *
 * One code per phone enforced at the app layer: if the user already has a
 * cohort_id, additional code attempts are no-ops (returns 'already_redeemed').
 */

const CODE_REGEX = /\b[a-z][a-z0-9]+-\d{3,}\b/i;

export type RedeemResult =
  | { kind: 'redeemed'; cohortId: CohortId; codeId: string }
  | { kind: 'already_redeemed'; existingCohortId: CohortId }
  | { kind: 'no_code_in_message' }
  | {
      kind: 'invalid_or_unredeemable';
      reason: 'not_found' | 'already_used' | 'expired' | 'revoked';
    };

export function extractCodeCandidate(text: string): string | null {
  const m = text.match(CODE_REGEX);
  return m === null ? null : m[0].toLowerCase();
}

/**
 * Atomic redeem on access_codes: WHERE status='unredeemed' SET
 * status='redeemed', redeemed_user_id, redeemed_at. Then user.cohort_id is
 * updated.
 *
 * Concurrency: WHERE status='unredeemed' makes the redeem CAS-style; only
 * one transaction per code can succeed. If two users race, the second sees
 * 0 rows updated → 'already_used'.
 */
export async function tryRedeemCode(
  db: Database,
  userId: UserId,
  text: string,
): Promise<RedeemResult> {
  const code = extractCodeCandidate(text);
  if (code === null) {
    return { kind: 'no_code_in_message' };
  }

  // Step 1: short-circuit if the user already has a cohort.
  const userRow = await db
    .select({ cohortId: users.cohortId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const existing = userRow[0]?.cohortId ?? null;
  if (existing !== null) {
    return { kind: 'already_redeemed', existingCohortId: asCohortId(existing) };
  }

  // Step 2: look up the code. Status determines the failure reason.
  const codeRow = await db
    .select({ id: accessCodes.id, cohortId: accessCodes.cohortId, status: accessCodes.status })
    .from(accessCodes)
    .where(eq(accessCodes.code, code))
    .limit(1);
  const found = codeRow[0];
  if (found === undefined) {
    return { kind: 'invalid_or_unredeemable', reason: 'not_found' };
  }
  if (found.status === 'redeemed') {
    return { kind: 'invalid_or_unredeemable', reason: 'already_used' };
  }
  if (found.status === 'expired') {
    return { kind: 'invalid_or_unredeemable', reason: 'expired' };
  }
  if (found.status === 'revoked') {
    return { kind: 'invalid_or_unredeemable', reason: 'revoked' };
  }

  // Step 3: atomic redeem.
  const updated = await db
    .update(accessCodes)
    .set({
      status: 'redeemed',
      redeemedUserId: userId,
      redeemedAt: sql`now()`,
    })
    .where(sql`${accessCodes.id} = ${found.id} AND ${accessCodes.status} = 'unredeemed'`)
    .returning({ id: accessCodes.id });

  if (updated[0] === undefined) {
    // Lost the race to another worker.
    return { kind: 'invalid_or_unredeemable', reason: 'already_used' };
  }

  // Step 4: bind user → cohort.
  await db.update(users).set({ cohortId: found.cohortId }).where(eq(users.id, userId));

  return { kind: 'redeemed', cohortId: asCohortId(found.cohortId), codeId: found.id };
}
