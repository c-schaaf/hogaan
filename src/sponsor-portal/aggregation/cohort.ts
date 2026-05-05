import { and, count, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Database } from '../../shared/db/client.js';
import { accessCodes } from '../../shared/db/schema/access-codes.js';
import { cohorts } from '../../shared/db/schema/cohorts.js';
import { users } from '../../shared/db/schema/users.js';

/**
 * Phase 9A.3 — cohort dashboard aggregations.
 *
 * Seats overview is the one place we do NOT apply the ≥30 threshold —
 * seat counts are NOT user data, they're sponsor-owned accounting. A
 * sponsor seeing "12 redeemed of 50" doesn't tell them anything about a
 * specific user; it tells them about their own purchase.
 *
 * Geography breakdown is a per-cohort attribute (set at cohort creation)
 * — also not user data.
 *
 * Redemption velocity is daily redemption counts — bucketed by date.
 * Buckets with fewer than the floor are still shown because the unit is
 * "redemptions per day", not "individual users". Sponsors need to see
 * uptake patterns to decide whether to issue more codes.
 */

export interface SeatsOverview {
  cohortId: string;
  cohortName: string;
  seatCount: number;
  redeemed: number;
  unredeemed: number;
  expired: number;
  revoked: number;
  redemptionRate: number;
}

export interface RedemptionVelocityPoint {
  date: string;
  redemptions: number;
}

export interface GeographyBreakdown {
  geography: string;
  cohorts: number;
  totalSeats: number;
  totalRedeemed: number;
}

export async function loadSeatsOverview(
  db: Database,
  cohortIds: readonly string[],
): Promise<SeatsOverview[]> {
  if (cohortIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({
      cohortId: cohorts.id,
      cohortName: cohorts.name,
      seatCount: cohorts.seatCount,
      status: accessCodes.status,
      countByStatus: count(accessCodes.id),
    })
    .from(cohorts)
    .leftJoin(accessCodes, eq(accessCodes.cohortId, cohorts.id))
    .where(inArray(cohorts.id, cohortIds as string[]))
    .groupBy(cohorts.id, cohorts.name, cohorts.seatCount, accessCodes.status);

  const byCohort = new Map<string, SeatsOverview>();
  for (const r of rows) {
    let agg = byCohort.get(r.cohortId);
    if (agg === undefined) {
      agg = {
        cohortId: r.cohortId,
        cohortName: r.cohortName,
        seatCount: r.seatCount,
        redeemed: 0,
        unredeemed: 0,
        expired: 0,
        revoked: 0,
        redemptionRate: 0,
      };
      byCohort.set(r.cohortId, agg);
    }
    if (r.status === 'redeemed') {
      agg.redeemed = r.countByStatus;
    } else if (r.status === 'unredeemed') {
      agg.unredeemed = r.countByStatus;
    } else if (r.status === 'expired') {
      agg.expired = r.countByStatus;
    } else if (r.status === 'revoked') {
      agg.revoked = r.countByStatus;
    }
  }

  for (const v of byCohort.values()) {
    v.redemptionRate = v.seatCount > 0 ? v.redeemed / v.seatCount : 0;
  }
  return Array.from(byCohort.values());
}

export async function loadRedemptionVelocity(
  db: Database,
  cohortIds: readonly string[],
  windowStart: Date,
  windowEnd: Date,
): Promise<RedemptionVelocityPoint[]> {
  if (cohortIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${accessCodes.redeemedAt}), 'YYYY-MM-DD')`,
      redemptions: count(accessCodes.id),
    })
    .from(accessCodes)
    .where(
      and(
        inArray(accessCodes.cohortId, cohortIds as string[]),
        eq(accessCodes.status, 'redeemed'),
        gte(accessCodes.redeemedAt, windowStart),
        lte(accessCodes.redeemedAt, windowEnd),
      ),
    )
    .groupBy(sql`date_trunc('day', ${accessCodes.redeemedAt})`)
    .orderBy(sql`date_trunc('day', ${accessCodes.redeemedAt})`);
  return rows.map((r) => ({ date: r.date, redemptions: r.redemptions }));
}

export async function loadGeographyBreakdown(
  db: Database,
  sponsorId: string,
): Promise<GeographyBreakdown[]> {
  const rows = await db
    .select({
      geography: cohorts.targetGeography,
      cohortCount: sql<number>`count(distinct ${cohorts.id})`,
      seatTotal: sql<number>`coalesce(sum(${cohorts.seatCount}), 0)`,
      redeemedTotal: sql<number>`count(${accessCodes.id}) filter (where ${accessCodes.status} = 'redeemed')`,
    })
    .from(cohorts)
    .leftJoin(accessCodes, eq(accessCodes.cohortId, cohorts.id))
    .where(eq(cohorts.sponsorId, sponsorId))
    .groupBy(cohorts.targetGeography);
  return rows.map((r) => ({
    geography: r.geography,
    cohorts: Number(r.cohortCount),
    totalSeats: Number(r.seatTotal),
    totalRedeemed: Number(r.redeemedTotal),
  }));
}

/** Helper for handlers — list cohort ids the sponsor owns (for sponsor_admin scope). */
export async function listSponsorCohortIds(db: Database, sponsorId: string): Promise<string[]> {
  const rows = await db
    .select({ id: cohorts.id })
    .from(cohorts)
    .where(eq(cohorts.sponsorId, sponsorId));
  return rows.map((r) => r.id);
}

/** Distinct active onboarded users joined to a set of cohorts. */
export async function countDistinctUsersInCohorts(
  db: Database,
  cohortIds: readonly string[],
): Promise<number> {
  if (cohortIds.length === 0) {
    return 0;
  }
  const rows = await db
    .select({ n: sql<number>`count(distinct ${users.id})` })
    .from(users)
    .where(and(eq(users.status, 'onboarded'), inArray(users.cohortId, cohortIds as string[])));
  return Number(rows[0]?.n ?? 0);
}
