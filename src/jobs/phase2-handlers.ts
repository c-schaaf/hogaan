import { eq } from 'drizzle-orm';
import { getActiveDailyPrompts } from '../libraries/index.js';
import { getMoment } from '../moments/store.js';
import type { Database } from '../shared/db/client.js';
import { decryptPlaintext } from '../shared/db/encryption.js';
import { moments } from '../shared/db/schema/moments.js';
import { users } from '../shared/db/schema/users.js';
import { getPrefs, nextLocalHour, sendProactiveEmail } from '../shared/email/proactive.js';
import { isEnabled } from '../shared/flags/index.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { enqueueJob, type JobHandlers, RescheduleJob } from './runner.js';
import { now as clockNow } from '../shared/clock.js';

/**
 * Email copy below is TRANSACTIONAL COPY WRITTEN BY ENGINEERING, flagged for
 * the founder's review (it speaks in Hogaan's name). It deliberately leaves
 * out what the moment was about: the inbox is not "private, always".
 */
async function firstNameOf(config: AppConfig, db: Database, userId: string): Promise<string> {
  const r = (
    await db
      .select({ enc: users.fullNameEncrypted })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (r?.enc === null || r?.enc === undefined) return 'there';
  try {
    return decryptPlaintext(config, r.enc).trim().split(/\s+/)[0] ?? 'there';
  } catch {
    return 'there';
  }
}

function base(config: AppConfig): string {
  return config.publicBaseUrl ?? 'http://localhost:3000';
}

/** ISO year-week, e.g. 2026-W46 (used for the weekly idempotency key). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Next Monday 09:00 in the leader's timezone (or `from` + 7d window). */
export function nextMondayMorning(from: Date, tz: string | null | undefined): Date {
  for (let i = 0; i < 8; i++) {
    const day = new Date(from.getTime() + i * 24 * 3600_000);
    const local = nextLocalHour(new Date(day.getTime() - (i === 0 ? 0 : 12 * 3600_000)), tz, 9);
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz ?? 'UTC', weekday: 'short' }).format(
      local,
    );
    if (wd === 'Mon' && local.getTime() > from.getTime()) return local;
  }
  return new Date(from.getTime() + 7 * 24 * 3600_000);
}

export async function scheduleWeeklyNudge(
  db: Database,
  userId: string,
  from = clockNow(),
): Promise<void> {
  const tz = (
    await db.select({ tz: users.timezone }).from(users).where(eq(users.id, userId)).limit(1)
  )[0]?.tz;
  await enqueueJob(db, {
    kind: 'nudge.weekly',
    dedupeKey: `nudge:${userId}`,
    payload: { userId },
    runAfter: nextMondayMorning(from, tz),
    mode: 'replace',
  });
}

export function phase2JobHandlers(config: AppConfig, db: Database): JobHandlers {
  return {
    // P2.2 — one follow-up per moment.
    'moment.followup': async (payload) => {
      if (!isEnabled(config, 'followUpEmail')) return;
      const userId = String(payload['userId']);
      const momentId = String(payload['momentId']);
      const m = await getMoment(config, db, userId, momentId);
      if (m === null || m.status !== 'upcoming' || m.followupSentAt !== null) return;
      const name = await firstNameOf(config, db, userId);
      const decision = await sendProactiveEmail(config, db, {
        userId,
        kind: 'followup',
        idempotencyKey: `followup:${momentId}`,
        subject: 'How did it go?',
        text: [
          `Hi ${name},`,
          '',
          'You were getting ready for a conversation. How did it go?',
          'Take two minutes to reflect, and Hogaan will remember what you learned:',
          `${base(config)}/reflect/${momentId}`,
          '',
          'Hogaan',
        ].join('\n'),
      });
      if (decision.outcome === 'capped' || decision.outcome === 'quiet_hours') {
        throw new RescheduleJob(decision.retryAt, decision.outcome);
      }
      if (decision.outcome === 'failed')
        throw new Error(`follow-up send failed: ${decision.reason}`);
      if (
        decision.outcome === 'sent' ||
        decision.outcome === 'captured' ||
        decision.outcome === 'duplicate'
      ) {
        await db
          .update(moments)
          .set({ followupSentAt: clockNow(), updatedAt: new Date() })
          .where(eq(moments.id, momentId));
      }
      // not_opted_in: nothing is sent and the job ends (one chance only).
    },

    // P2.6 — optional weekly nudge built from the existing daily-prompt library.
    'nudge.weekly': async (payload) => {
      if (!isEnabled(config, 'weeklyNudge')) return;
      const userId = String(payload['userId']);
      const prefs = await getPrefs(db, userId);
      if (!prefs.weeklyNudgeOptIn || prefs.unsubscribedAll) return; // stops the cycle
      const now = clockNow();
      const u = (
        await db
          .select({ practices: users.mappedPractices, tz: users.timezone })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
      )[0];
      const lib = await getActiveDailyPrompts(db);
      const mine = new Set(
        (Array.isArray(u?.practices) ? (u.practices as string[]) : []).map((p) => p.toLowerCase()),
      );
      const pool = lib.payload.prompts.filter((p) => mine.size === 0 || mine.has(p.practice));
      const list = pool.length > 0 ? pool : lib.payload.prompts;
      const week = isoWeek(now);
      const idx = Number.parseInt(week.slice(-2), 10) % list.length;
      const prompt = list[idx];
      const name = await firstNameOf(config, db, userId);
      const decision = await sendProactiveEmail(config, db, {
        userId,
        kind: 'weekly_nudge',
        idempotencyKey: `nudge:${userId}:${week}`,
        subject: 'A question for your week',
        text: [
          `Hi ${name},`,
          '',
          prompt?.body ?? '',
          '',
          `Talk it through with Hogaan: ${base(config)}/`,
          '',
          'Hogaan',
        ].join('\n'),
      });
      if (decision.outcome === 'capped' || decision.outcome === 'quiet_hours') {
        throw new RescheduleJob(decision.retryAt, decision.outcome);
      }
      if (decision.outcome === 'failed') throw new Error(`nudge send failed: ${decision.reason}`);
      // Recurring: run again next Monday morning.
      throw new RescheduleJob(nextMondayMorning(now, u?.tz), 'weekly');
    },
  };
}
