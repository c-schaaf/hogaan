import { and, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Database } from '../../shared/db/client.js';
import { turns } from '../../shared/db/schema/turns.js';
import { users } from '../../shared/db/schema/users.js';
import { requireSegmentSize, type Segment } from './privacy.js';

/**
 * Phase 9A.4 — engagement metrics with privacy-floor enforcement.
 *
 * Every function here returns a `Segment<T>` — visible only when the
 * underlying distinct-user count meets the floor. The floor is applied
 * BOTH at the SQL layer (HAVING / filter) for grouped breakdowns AND in
 * the app via `requireSegmentSize` as the last gate before the handler.
 */

export interface EngagementSummary {
  /** Total seats redeemed in the cohort window. */
  redeemedSeats: number;
  /** Distinct active users in the lookback window. */
  activeDistinctUsers: number;
  activePct: number;
  totalSessions: number;
  totalTurns: number;
  medianSessionLengthTurns: number;
}

export interface RetentionPoint {
  weekIndex: 1 | 2 | 4 | 8 | 12;
  /** Distinct users active in week w. */
  activeUsers: number;
  /** % of cohort onboarded baseline that returned in week w. */
  pct: number;
}

const ACTIVE_WINDOW_DAYS = 14;
const RETENTION_WEEKS = [1, 2, 4, 8, 12] as const;

export async function loadEngagementSummary(
  db: Database,
  cohortIds: readonly string[],
  now: Date = new Date(),
): Promise<Segment<EngagementSummary>> {
  if (cohortIds.length === 0) {
    return requireSegmentSize(0, defaultSummary());
  }

  const seatsRow = await db
    .select({
      seats: sql<number>`count(${users.id})`,
    })
    .from(users)
    .where(and(inArray(users.cohortId, cohortIds as string[]), sql`${users.status} = 'onboarded'`));
  const redeemedSeats = Number(seatsRow[0]?.seats ?? 0);

  const windowStart = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const activeUsersRow = await db
    .select({
      activeUsers: sql<number>`count(distinct ${turns.userId})`,
      totalSessions: sql<number>`count(distinct ${turns.sessionId})`,
      totalTurns: sql<number>`count(${turns.id})`,
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

  const activeDistinctUsers = Number(activeUsersRow[0]?.activeUsers ?? 0);
  const totalSessions = Number(activeUsersRow[0]?.totalSessions ?? 0);
  const totalTurns = Number(activeUsersRow[0]?.totalTurns ?? 0);

  // Median session length — fetch per-session turn counts, compute median
  // in JS. Bounded by total sessions in the window per cohort.
  const sessionCountsRows = await db
    .select({
      sessionId: turns.sessionId,
      turnCount: sql<number>`count(${turns.id})`,
    })
    .from(turns)
    .innerJoin(users, sql`${users.id} = ${turns.userId}`)
    .where(
      and(
        inArray(users.cohortId, cohortIds as string[]),
        gte(turns.createdAt, windowStart),
        lte(turns.createdAt, now),
      ),
    )
    .groupBy(turns.sessionId);

  const counts = sessionCountsRows.map((r) => Number(r.turnCount)).sort((a, b) => a - b);
  let median = 0;
  if (counts.length > 0) {
    const mid = Math.floor(counts.length / 2);
    median =
      counts.length % 2 === 0 ? Math.round((counts[mid - 1]! + counts[mid]!) / 2) : counts[mid]!;
  }

  const summary: EngagementSummary = {
    redeemedSeats,
    activeDistinctUsers,
    activePct: redeemedSeats > 0 ? activeDistinctUsers / redeemedSeats : 0,
    totalSessions,
    totalTurns,
    medianSessionLengthTurns: median,
  };

  return requireSegmentSize(activeDistinctUsers, summary);
}

export async function loadRetentionCurve(
  db: Database,
  cohortIds: readonly string[],
  now: Date = new Date(),
): Promise<Segment<RetentionPoint[]>> {
  if (cohortIds.length === 0) {
    return requireSegmentSize(0, []);
  }

  // Baseline = distinct onboarded users joined to these cohorts.
  const baselineRow = await db
    .select({ n: sql<number>`count(distinct ${users.id})` })
    .from(users)
    .where(and(inArray(users.cohortId, cohortIds as string[]), sql`${users.status} = 'onboarded'`));
  const baseline = Number(baselineRow[0]?.n ?? 0);

  const points: RetentionPoint[] = [];
  for (const w of RETENTION_WEEKS) {
    const start = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    const row = await db
      .select({ active: sql<number>`count(distinct ${turns.userId})` })
      .from(turns)
      .innerJoin(users, sql`${users.id} = ${turns.userId}`)
      .where(
        and(
          inArray(users.cohortId, cohortIds as string[]),
          gte(turns.createdAt, start),
          lte(turns.createdAt, end),
        ),
      );
    const active = Number(row[0]?.active ?? 0);
    points.push({
      weekIndex: w,
      activeUsers: active,
      pct: baseline > 0 ? active / baseline : 0,
    });
  }

  return requireSegmentSize(baseline, points);
}

export interface PracticeDistribution {
  practice: string;
  turnCount: number;
  distinctUsers: number;
}

export async function loadPracticeDistribution(
  db: Database,
  cohortIds: readonly string[],
  now: Date = new Date(),
): Promise<Segment<PracticeDistribution[]>> {
  if (cohortIds.length === 0) {
    return requireSegmentSize(0, []);
  }
  const windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      practice: sql<string>`coalesce(${turns.practiceTag}, 'untagged')`,
      turnCount: sql<number>`count(${turns.id})`,
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
    )
    .groupBy(turns.practiceTag)
    // SQL-layer floor: any group with <30 distinct users is dropped here, so
    // the app never even sees small slices.
    .having(sql`count(distinct ${turns.userId}) >= 30`);

  const totalDistinct = await db
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

  const distribution: PracticeDistribution[] = rows.map((r) => ({
    practice: r.practice,
    turnCount: Number(r.turnCount),
    distinctUsers: Number(r.distinctUsers),
  }));

  return requireSegmentSize(Number(totalDistinct[0]?.n ?? 0), distribution);
}

function defaultSummary(): EngagementSummary {
  return {
    redeemedSeats: 0,
    activeDistinctUsers: 0,
    activePct: 0,
    totalSessions: 0,
    totalTurns: 0,
    medianSessionLengthTurns: 0,
  };
}
