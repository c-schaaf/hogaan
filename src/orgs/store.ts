import { createHash, randomBytes } from 'node:crypto';
import { and, count, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { rowsOf } from '../shared/db/rows.js';
import {
  cohortInvites,
  cohortMembers,
  cohorts,
  orgAdmins,
  organizations,
} from '../shared/db/schema/orgs.js';

/**
 * P5.1 — organizations, cohorts, invite codes, memberships.
 * P5.3 — the funder report, read ONLY through analytics.cohort_report,
 * which enforces the D5 floor (>= 10 enrolled) inside the database.
 */

export const MIN_REPORT_GROUP = 10;

/** P5.4 — shown to a leader before joining and on their Profile. */
export const SPONSOR_STATEMENT = {
  canSee: [
    'How many leaders in your cohort have joined and been active',
    'Totals for the whole cohort: sessions, conversations prepared for, reflections, how they went (well / mixed / hard)',
    'Which of the twelve practices leaders in the cohort have chosen, as counts',
  ],
  cannotSee: [
    'Anything you say to Hogaan, or any summary of it',
    'Your name, email, or anything that identifies you in the report',
    'Your notes, goals, moments or reflections',
    'Any report at all for a cohort with fewer than 10 active leaders',
  ],
};

function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

/** HGN-XXXX-XXXX from an unambiguous alphabet. */
export function newInviteCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `HGN-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

export async function isOrgAdmin(db: Database, userId: string, orgId: string): Promise<boolean> {
  const r = await db
    .select({ o: orgAdmins.orgId })
    .from(orgAdmins)
    .where(and(eq(orgAdmins.orgId, orgId), eq(orgAdmins.userId, userId)))
    .limit(1);
  return r[0] !== undefined;
}

async function cohortOrg(db: Database, cohortId: string): Promise<string | null> {
  const r = await db
    .select({ orgId: cohorts.orgId })
    .from(cohorts)
    .where(eq(cohorts.id, cohortId))
    .limit(1);
  return r[0]?.orgId ?? null;
}

export async function isCohortAdmin(
  db: Database,
  userId: string,
  cohortId: string,
): Promise<boolean> {
  const orgId = await cohortOrg(db, cohortId);
  return orgId !== null && (await isOrgAdmin(db, userId, orgId));
}

export async function createOrg(
  db: Database,
  userId: string,
  input: { name: string; kind?: 'funder' | 'employer' | 'program' },
): Promise<{ id: string; name: string }> {
  const o = (
    await db
      .insert(organizations)
      .values({ name: input.name.slice(0, 120), kind: input.kind ?? 'funder' })
      .returning({ id: organizations.id, name: organizations.name })
  )[0]!;
  await db.insert(orgAdmins).values({ orgId: o.id, userId });
  return o;
}

/** Ops action (scripts/verify-org.ts): mark an organization as vetted. */
export async function verifyOrg(db: Database, orgId: string): Promise<boolean> {
  const r = await db
    .update(organizations)
    .set({ verifiedAt: new Date() })
    .where(eq(organizations.id, orgId))
    .returning({ id: organizations.id });
  return r[0] !== undefined;
}

export async function createCohort(
  db: Database,
  orgId: string,
  input: { name: string; seatLimit: number; endsAt?: Date | null },
): Promise<{ id: string }> {
  return (
    await db
      .insert(cohorts)
      .values({
        orgId,
        name: input.name.slice(0, 120),
        seatLimit: input.seatLimit,
        endsAt: input.endsAt ?? null,
      })
      .returning({ id: cohorts.id })
  )[0]!;
}

export async function createInvite(
  db: Database,
  cohortId: string,
  expiresAt: Date | null = null,
): Promise<string> {
  const code = newInviteCode();
  await db.insert(cohortInvites).values({ cohortId, codeHash: hashCode(code), expiresAt });
  return code;
}

async function activeCount(db: Database, cohortId: string): Promise<number> {
  const r = await db
    .select({ n: count() })
    .from(cohortMembers)
    .where(and(eq(cohortMembers.cohortId, cohortId), isNull(cohortMembers.leftAt)));
  return Number(r[0]?.n ?? 0);
}

export type JoinResult =
  | { ok: true; cohortId: string; cohortName: string; orgName: string }
  | { ok: false; reason: 'invalid_code' | 'cohort_full' | 'cohort_ended' | 'sponsor_cannot_join' };

export async function joinByCode(db: Database, userId: string, code: string): Promise<JoinResult> {
  const now = new Date();
  const inv = (
    await db
      .select({ cohortId: cohortInvites.cohortId })
      .from(cohortInvites)
      .where(
        and(
          eq(cohortInvites.codeHash, hashCode(code)),
          isNull(cohortInvites.revokedAt),
          or(isNull(cohortInvites.expiresAt), gt(cohortInvites.expiresAt, now)),
        ),
      )
      .limit(1)
  )[0];
  if (inv === undefined) return { ok: false, reason: 'invalid_code' };
  const c = (
    await db
      .select({
        id: cohorts.id,
        name: cohorts.name,
        seatLimit: cohorts.seatLimit,
        endsAt: cohorts.endsAt,
        orgName: organizations.name,
        orgId: cohorts.orgId,
      })
      .from(cohorts)
      .innerJoin(organizations, eq(organizations.id, cohorts.orgId))
      .where(eq(cohorts.id, inv.cohortId))
      .limit(1)
  )[0]!;
  if (c.endsAt !== null && c.endsAt < now) return { ok: false, reason: 'cohort_ended' };
  // A sponsor's own admins can never be counted as leaders in its cohorts.
  if (await isOrgAdmin(db, userId, c.orgId)) return { ok: false, reason: 'sponsor_cannot_join' };
  const existing = (
    await db
      .select({ leftAt: cohortMembers.leftAt })
      .from(cohortMembers)
      .where(and(eq(cohortMembers.cohortId, c.id), eq(cohortMembers.userId, userId)))
      .limit(1)
  )[0];
  if (existing !== undefined && existing.leftAt === null) {
    return { ok: true, cohortId: c.id, cohortName: c.name, orgName: c.orgName };
  }
  if ((await activeCount(db, c.id)) >= c.seatLimit) return { ok: false, reason: 'cohort_full' };
  await db
    .insert(cohortMembers)
    .values({ cohortId: c.id, userId, joinedAt: now })
    .onConflictDoUpdate({
      target: [cohortMembers.cohortId, cohortMembers.userId],
      set: { leftAt: null, joinedAt: now },
    });
  return { ok: true, cohortId: c.id, cohortName: c.name, orgName: c.orgName };
}

export async function leaveCohort(
  db: Database,
  userId: string,
  cohortId: string,
): Promise<boolean> {
  const r = await db
    .update(cohortMembers)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(cohortMembers.cohortId, cohortId),
        eq(cohortMembers.userId, userId),
        isNull(cohortMembers.leftAt),
      ),
    )
    .returning({ c: cohortMembers.cohortId });
  return r[0] !== undefined;
}

export async function myMemberships(db: Database, userId: string) {
  return db
    .select({
      cohortId: cohorts.id,
      cohortName: cohorts.name,
      orgName: organizations.name,
      joinedAt: cohortMembers.joinedAt,
      endsAt: cohorts.endsAt,
    })
    .from(cohortMembers)
    .innerJoin(cohorts, eq(cohorts.id, cohortMembers.cohortId))
    .innerJoin(organizations, eq(organizations.id, cohorts.orgId))
    .where(and(eq(cohortMembers.userId, userId), isNull(cohortMembers.leftAt)));
}

/** Organizations this user administers, with their cohorts and seat use. */
export async function adminView(db: Database, userId: string) {
  const orgs = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      kind: organizations.kind,
      verified: sql<boolean>`${organizations.verifiedAt} IS NOT NULL`,
    })
    .from(organizations)
    .innerJoin(orgAdmins, eq(orgAdmins.orgId, organizations.id))
    .where(eq(orgAdmins.userId, userId));
  const out = [];
  for (const o of orgs) {
    const cs = await db
      .select({
        id: cohorts.id,
        name: cohorts.name,
        seatLimit: cohorts.seatLimit,
        endsAt: cohorts.endsAt,
      })
      .from(cohorts)
      .where(eq(cohorts.orgId, o.id));
    const withCounts = [];
    for (const c of cs) withCounts.push({ ...c, enrolled: await activeCount(db, c.id) });
    out.push({ ...o, cohorts: withCounts });
  }
  return out;
}

export interface CohortReport {
  enrolled: number;
  seatLimit: number;
  activeLast4Weeks: number;
  coachingSessions: number;
  momentsPrepared: number;
  loopsClosed: number;
  outcomes: { well: number; mixed: number; hard: number };
  avgConfidenceChange: number | null;
  practiceCoverage: Record<string, number>;
}

/** Null when the cohort is under the D5 floor (the view returns no row). */
export async function cohortReport(db: Database, cohortId: string): Promise<CohortReport | null> {
  const r = rowsOf<Record<string, unknown>>(
    await db.execute(sql`SELECT * FROM analytics.cohort_report WHERE cohort_id = ${cohortId}`),
  )[0];
  if (r === undefined) return null;
  const n = (k: string) => Number(r[k] ?? 0);
  const pc = r['practice_coverage'];
  return {
    enrolled: n('enrolled'),
    seatLimit: n('seat_limit'),
    activeLast4Weeks: n('active_last_4_weeks'),
    coachingSessions: n('coaching_sessions'),
    momentsPrepared: n('moments_prepared'),
    loopsClosed: n('loops_closed'),
    outcomes: { well: n('outcomes_well'), mixed: n('outcomes_mixed'), hard: n('outcomes_hard') },
    avgConfidenceChange:
      r['avg_confidence_change'] === null ? null : Number(r['avg_confidence_change']),
    practiceCoverage:
      typeof pc === 'string'
        ? (JSON.parse(pc) as Record<string, number>)
        : ((pc as Record<string, number>) ?? {}),
  };
}

export function reportCsv(cohortName: string, r: CohortReport): string {
  const rows: [string, string | number][] = [
    ['cohort', cohortName],
    ['enrolled', r.enrolled],
    ['seat_limit', r.seatLimit],
    ['active_last_4_weeks', r.activeLast4Weeks],
    ['coaching_sessions', r.coachingSessions],
    ['moments_prepared', r.momentsPrepared],
    ['loops_closed', r.loopsClosed],
    ['outcomes_well', r.outcomes.well],
    ['outcomes_mixed', r.outcomes.mixed],
    ['outcomes_hard', r.outcomes.hard],
    ['avg_confidence_change', r.avgConfidenceChange ?? ''],
    ...Object.entries(r.practiceCoverage).map(
      ([p, v]) => [`practice_${p.toLowerCase()}`, v] as [string, number],
    ),
  ];
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return ['metric,value', ...rows.map(([k, v]) => `${esc(k)},${esc(v)}`)].join('\n') + '\n';
}
