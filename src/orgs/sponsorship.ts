import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { cohortMembers, cohorts } from '../shared/db/schema/orgs.js';
import type { AppConfig } from '../shared/secrets/config.js';

/** P5 — a leader holds a sponsored seat while in a cohort that has not ended. */
export async function hasSponsoredSeat(
  _config: AppConfig,
  db: Database,
  userId: string,
): Promise<boolean> {
  const r = await db
    .select({ c: cohortMembers.cohortId })
    .from(cohortMembers)
    .innerJoin(cohorts, eq(cohorts.id, cohortMembers.cohortId))
    .where(
      and(
        eq(cohortMembers.userId, userId),
        isNull(cohortMembers.leftAt),
        or(isNull(cohorts.endsAt), gt(cohorts.endsAt, new Date())),
      ),
    )
    .limit(1);
  return r[0] !== undefined;
}
