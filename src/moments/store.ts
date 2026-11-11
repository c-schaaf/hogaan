import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { cancelJob, enqueueJob } from '../jobs/runner.js';
import { appendLine } from '../leader-context/store.js';
import type { Database } from '../shared/db/client.js';
import { decryptPlaintext, encryptPlaintext } from '../shared/db/encryption.js';
import { momentOutcomes, moments } from '../shared/db/schema/moments.js';
import { users } from '../shared/db/schema/users.js';
import { followUpTime } from '../shared/email/proactive.js';
import { isEnabled } from '../shared/flags/index.js';
import { stripPii } from '../shared/pii/filter.js';
import type { AppConfig } from '../shared/secrets/config.js';

/**
 * P2.1 / P2.3 — moments and outcomes.
 *
 * A moment is something the leader is preparing for: what, with whom (by
 * ROLE — never a name), and when. Moments come from three places: the
 * background brief update (the leader mentioned it in a session), the
 * leader adding one by hand, and the MCP `log_moment` tool.
 *
 * When a moment has a time and FEATURE_FOLLOWUP_EMAIL is on, one follow-up
 * job is scheduled for the next local 09:00 after it. Whether an email
 * actually goes out is decided at send time (opt-in, cap, quiet hours).
 */

export type MomentStatus = 'upcoming' | 'reflected' | 'dismissed';
export type MomentSource = 'conversation' | 'leader' | 'assistant';
export type HowItWent = 'well' | 'mixed' | 'hard';

export interface MomentView {
  id: string;
  what: string;
  withWhom: string | null;
  happensAt: string | null;
  status: MomentStatus;
  source: MomentSource;
  followupSentAt: string | null;
  createdAt: string;
  outcome: { howItWent: HowItWent; differently: string | null; createdAt: string } | null;
}

const MAX_WHAT = 160;
const MAX_WHO = 60;

function dedupeHash(what: string): string {
  return createHash('sha256')
    .update(
      what
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim(),
    )
    .digest('hex')
    .slice(0, 32);
}

function clean(text: string, max: number): string {
  return stripPii(text.replace(/\s+/g, ' ').trim()).slice(0, max);
}

export async function createMoment(
  config: AppConfig,
  db: Database,
  userId: string,
  input: {
    what: string;
    withWhom?: string | null;
    happensAt?: Date | null;
    source: MomentSource;
    sessionId?: string | null;
  },
): Promise<MomentView | null> {
  const what = clean(input.what, MAX_WHAT);
  if (what.length === 0) return null;
  const who = input.withWhom ? clean(input.withWhom, MAX_WHO) : '';
  const inserted = await db
    .insert(moments)
    .values({
      userId,
      sessionId: input.sessionId ?? null,
      whatEncrypted: encryptPlaintext(config, what),
      withWhomEncrypted: who.length > 0 ? encryptPlaintext(config, who) : null,
      happensAt: input.happensAt ?? null,
      source: input.source,
      dedupeHash: dedupeHash(what),
    })
    .onConflictDoNothing()
    .returning({ id: moments.id });
  const id = inserted[0]?.id;
  if (id === undefined) return null; // already known
  await scheduleFollowUp(config, db, userId, id);
  return getMoment(config, db, userId, id);
}

/** Called by the brief.update job with what the background model found. */
export async function recordExtractedMoments(
  config: AppConfig,
  db: Database,
  userId: string,
  sessionId: string,
  found: { what: string; withWhom: string; when: string | null }[],
): Promise<void> {
  for (const m of found.slice(0, 5)) {
    let happensAt: Date | null = null;
    if (m.when !== null) {
      const d = new Date(m.when);
      happensAt = Number.isNaN(d.getTime()) ? null : d;
    }
    await createMoment(config, db, userId, {
      what: m.what,
      withWhom: m.withWhom,
      happensAt,
      source: 'conversation',
      sessionId,
    });
  }
}

function view(
  config: AppConfig,
  r: typeof moments.$inferSelect,
  o: typeof momentOutcomes.$inferSelect | undefined,
): MomentView {
  return {
    id: r.id,
    what: decryptPlaintext(config, r.whatEncrypted),
    withWhom: r.withWhomEncrypted !== null ? decryptPlaintext(config, r.withWhomEncrypted) : null,
    happensAt: r.happensAt?.toISOString() ?? null,
    status: r.status as MomentStatus,
    source: r.source as MomentSource,
    followupSentAt: r.followupSentAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    outcome:
      o === undefined
        ? null
        : {
            howItWent: o.howItWent as HowItWent,
            differently:
              o.differentlyEncrypted !== null
                ? decryptPlaintext(config, o.differentlyEncrypted)
                : null,
            createdAt: o.createdAt.toISOString(),
          },
  };
}

export async function listMoments(
  config: AppConfig,
  db: Database,
  userId: string,
): Promise<MomentView[]> {
  const rows = await db
    .select()
    .from(moments)
    .where(eq(moments.userId, userId))
    .orderBy(desc(moments.createdAt))
    .limit(100);
  if (rows.length === 0) return [];
  const outs = await db
    .select()
    .from(momentOutcomes)
    .where(
      inArray(
        momentOutcomes.momentId,
        rows.map((r) => r.id),
      ),
    );
  const byMoment = new Map(outs.map((o) => [o.momentId, o]));
  return rows.map((r) => view(config, r, byMoment.get(r.id)));
}

export async function getMoment(
  config: AppConfig,
  db: Database,
  userId: string,
  id: string,
): Promise<MomentView | null> {
  const r = (
    await db
      .select()
      .from(moments)
      .where(and(eq(moments.id, id), eq(moments.userId, userId)))
      .limit(1)
  )[0];
  if (r === undefined) return null;
  const o = (
    await db.select().from(momentOutcomes).where(eq(momentOutcomes.momentId, id)).limit(1)
  )[0];
  return view(config, r, o);
}

export async function scheduleFollowUp(
  config: AppConfig,
  db: Database,
  userId: string,
  momentId: string,
): Promise<void> {
  const key = `followup:${momentId}`;
  if (!isEnabled(config, 'followUpEmail')) return;
  const r = (
    await db
      .select({
        happensAt: moments.happensAt,
        status: moments.status,
        sent: moments.followupSentAt,
      })
      .from(moments)
      .where(eq(moments.id, momentId))
      .limit(1)
  )[0];
  if (r === undefined || r.status !== 'upcoming' || r.happensAt === null || r.sent !== null) {
    await cancelJob(db, key);
    return;
  }
  const tz = (
    await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1)
  )[0]?.tz;
  await enqueueJob(db, {
    kind: 'moment.followup',
    dedupeKey: key,
    payload: { userId, momentId },
    runAfter: followUpTime(r.happensAt, tz),
    mode: 'replace',
  });
}

export async function updateMoment(
  config: AppConfig,
  db: Database,
  userId: string,
  id: string,
  patch: { happensAt?: Date | null; status?: 'upcoming' | 'dismissed' },
): Promise<MomentView | null> {
  const updated = await db
    .update(moments)
    .set({
      ...(patch.happensAt !== undefined ? { happensAt: patch.happensAt } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(moments.id, id), eq(moments.userId, userId)))
    .returning({ id: moments.id });
  if (updated[0] === undefined) return null;
  await scheduleFollowUp(config, db, userId, id);
  return getMoment(config, db, userId, id);
}

export async function deleteMoment(db: Database, userId: string, id: string): Promise<boolean> {
  const del = await db
    .delete(moments)
    .where(and(eq(moments.id, id), eq(moments.userId, userId)))
    .returning({ id: moments.id });
  if (del[0] !== undefined) await cancelJob(db, `followup:${id}`);
  return del[0] !== undefined;
}

const HOW_LABEL: Record<HowItWent, string> = {
  well: 'went well',
  mixed: 'was mixed',
  hard: 'was hard',
};

/**
 * P2.3 — capture the outcome. Writes the outcome row, marks the moment
 * reflected, cancels any pending follow-up, and adds a reflection line to
 * the leader's Notes so the next session's coaching can refer to it.
 */
export async function recordOutcome(
  config: AppConfig,
  db: Database,
  userId: string,
  momentId: string,
  input: {
    howItWent: HowItWent;
    differently?: string;
    confidenceBefore?: number | null;
    confidenceAfter?: number | null;
  },
): Promise<MomentView | null> {
  const m = await getMoment(config, db, userId, momentId);
  if (m === null) return null;
  const differently =
    input.differently !== undefined && input.differently.trim().length > 0
      ? clean(input.differently, 500)
      : null;
  const values = {
    momentId,
    userId,
    howItWent: input.howItWent,
    differentlyEncrypted: differently !== null ? encryptPlaintext(config, differently) : null,
    confidenceBefore: input.confidenceBefore ?? null,
    confidenceAfter: input.confidenceAfter ?? null,
  };
  await db
    .insert(momentOutcomes)
    .values(values)
    .onConflictDoUpdate({ target: momentOutcomes.momentId, set: values });
  await db
    .update(moments)
    .set({ status: 'reflected', updatedAt: new Date() })
    .where(eq(moments.id, momentId));
  await cancelJob(db, `followup:${momentId}`);
  if (isEnabled(config, 'leaderBrief')) {
    const when = m.happensAt !== null ? ` (${m.happensAt.slice(0, 10)})` : '';
    const line = `Reflection on "${m.what}"${when}: it ${HOW_LABEL[input.howItWent]}.${
      differently !== null ? ` Would do differently: ${differently}` : ''
    }`;
    await appendLine(config, db, userId, 'notes', line, 'reflection');
  }
  return getMoment(config, db, userId, momentId);
}

/** Prompt block listing upcoming and just-passed moments (P2.1). */
export function renderMomentsBlock(list: MomentView[], now = new Date()): string {
  const soon = now.getTime() + 14 * 24 * 3600_000;
  const recent = now.getTime() - 7 * 24 * 3600_000;
  const lines = list
    .filter((m) => m.status === 'upcoming')
    .filter(
      (m) =>
        m.happensAt === null ||
        (Date.parse(m.happensAt) <= soon && Date.parse(m.happensAt) >= recent),
    )
    .slice(0, 5)
    .map((m) => {
      const who = m.withWhom !== null ? ` with ${m.withWhom}` : '';
      const when =
        m.happensAt === null
          ? ' (date not known yet)'
          : Date.parse(m.happensAt) < now.getTime()
            ? ` (happened ${m.happensAt.slice(0, 10)}; not yet reflected on)`
            : ` (${m.happensAt.slice(0, 10)})`;
      return `- ${m.what}${who}${when}`;
    });
  if (lines.length === 0) return '';
  return [
    '## Moments the leader is preparing for',
    ...lines,
    '[engineering placeholder — pending founder review] If the leader is preparing for an upcoming conversation and has not said when it happens, ask when, so Hogaan can check in afterwards.',
  ].join('\n');
}
