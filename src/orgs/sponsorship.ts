import { and, eq, gt, isNotNull, isNull, or } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { cohortMembers, cohorts, organizations } from '../shared/db/schema/orgs.js';
import type { AppConfig } from '../shared/secrets/config.js';

/**
 * P5 — a leader holds a sponsored seat while in a cohort that has not ended,
 * run by an organization Hogaan staff have VERIFIED. Without verification
 * anyone could create an organization, sponsor themselves and get the paid
 * plan free (found in the build's security review).
 */
export async function hasSponsoredSeat(
  _config: AppConfig,
  db: Database,
  userId: string,
): Promise<boolean> {
  const r = await db
    .select({ c: cohortMembers.cohortId })
    .from(cohortMembers)
    .innerJoin(cohorts, eq(cohorts.id, cohortMembers.cohortId))
    .innerJoin(organizations, eq(organizations.id, cohorts.orgId))
    .where(
      and(
        isNotNull(organizations.verifiedAt),
        eq(cohortMembers.userId, userId),
        isNull(cohortMembers.leftAt),
        or(isNull(cohorts.endsAt), gt(cohorts.endsAt, new Date())),
      ),
    )
    .limit(1);
  return r[0] !== undefined;
}
