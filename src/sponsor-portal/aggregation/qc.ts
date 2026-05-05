import { and, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Database } from '../../shared/db/client.js';
import { crisisEvents } from '../../shared/db/schema/crisis-events.js';
import { turns } from '../../shared/db/schema/turns.js';
import { users } from '../../shared/db/schema/users.js';
import { requireSegmentSize, type Segment } from './privacy.js';

/**
 * Phase 9A.5 — QC + crisis aggregations.
 *
 * QC pass rate is computed over qa_outcome on the turns table. Approval is
 * either E1_ApprovedFirstAttempt or E2_ApprovedRegenerated; everything else
 * is a non-approval (degraded / max-retries / service-unavailable / safety
 * hard-fail). We surface the rate, not raw outcome distributions, and never
 * the actual response_text.
 *
 * Crisis category counts are over crisis_events (no transcripts, no
 * user_message). Outcome categories are aggregated by category, never
 * per-user.
 *
 * Both gated by ≥30-distinct-user floor on the originating cohort.
 */

export interface QcSummary {
  totalTurns: number;
  approvedTurns: number;
  passRate: number;
  degradedTurns: number;
  retryRate: number;
}

export interface CrisisCategoryCount {
  category: string;
  count: number;
}

const QC_WINDOW_DAYS = 30;

export async function loadQcSummary(
  db: Database,
  cohortIds: readonly string[],
  now: Date = new Date(),
): Promise<Segment<QcSummary>> {
  if (cohortIds.length === 0) {
    return requireSegmentSize(0, defaultQcSummary());
  }
  const windowStart = new Date(now.getTime() - QC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const row = await db
    .select({
      totalTurns: sql<number>`count(${turns.id})`,
      approvedTurns: sql<number>`count(*) filter (where ${turns.qaOutcome} in ('E1_ApprovedFirstAttempt', 'E2_ApprovedRegenerated'))`,
      degradedTurns: sql<number>`count(*) filter (where ${turns.qaOutcome} = 'E3_MaxRetriesExceeded' or ${turns.qaOutcome} = 'E6_ServiceUnavailable')`,
      retryTurns: sql<number>`count(*) filter (where ${turns.retryCount} > 0)`,
      distinctUsers: sql<number>`count(distinct ${turns.userId})`,
    })
    .from(turns)
    .innerJoin(users, sql`${users.id} = ${turns.userId}`)
    .where(
      and(
        inArray(users.cohortId, cohortIds as string[]),
        gte(turns.createdAt, windowStart),
        lte(turns.createdAt, now),
      ),
    );

  const total = Number(row[0]?.totalTurns ?? 0);
  const approved = Number(row[0]?.approvedTurns ?? 0);
  const degraded = Number(row[0]?.degradedTurns ?? 0);
  const retried = Number(row[0]?.retryTurns ?? 0);
  const distinctUsers = Number(row[0]?.distinctUsers ?? 0);

  const summary: QcSummary = {
    totalTurns: total,
    approvedTurns: approved,
    passRate: total > 0 ? approved / total : 0,
    degradedTurns: degraded,
    retryRate: total > 0 ? retried / total : 0,
  };
  return requireSegmentSize(distinctUsers, summary);
}

export async function loadCrisisCategoryCounts(
  db: Database,
  cohortIds: readonly string[],
  now: Date = new Date(),
): Promise<Segment<CrisisCategoryCount[]>> {
  if (cohortIds.length === 0) {
    return requireSegmentSize(0, []);
  }
  const windowStart = new Date(now.getTime() - QC_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Crisis is rare AND highly sensitive — apply the user-floor over the
  // baseline cohort engagement, not the crisis count itself. We never want
  // a cohort with 5 users showing "1 crisis event" — that's de-anonymizing.
  const baseline = await db
    .select({ n: sql<number>`count(distinct ${turns.userId})` })
    .from(turns)
    .innerJoin(users, sql`${users.id} = ${turns.userId}`)
    .where(
      and(
        inArray(users.cohortId, cohortIds as string[]),
        gte(turns.createdAt, windowStart),
        lte(turns.createdAt, now),
      ),
    );

  const rows = await db
    .select({
      category: crisisEvents.outcomeCategory,
      n: sql<number>`count(${crisisEvents.id})`,
    })
    .from(crisisEvents)
    .innerJoin(users, sql`${users.id} = ${crisisEvents.userId}`)
    .where(
      and(
        inArray(users.cohortId, cohortIds as string[]),
        gte(crisisEvents.createdAt, windowStart),
        lte(crisisEvents.createdAt, now),
      ),
    )
    .groupBy(crisisEvents.outcomeCategory);

  const counts: CrisisCategoryCount[] = rows.map((r) => ({
    category: r.category,
    count: Number(r.n),
  }));

  return requireSegmentSize(Number(baseline[0]?.n ?? 0), counts);
}

function defaultQcSummary(): QcSummary {
  return {
    totalTurns: 0,
    approvedTurns: 0,
    passRate: 0,
    degradedTurns: 0,
    retryRate: 0,
  };
}
