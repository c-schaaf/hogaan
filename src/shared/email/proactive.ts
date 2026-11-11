import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { emailSends, notificationPrefs } from '../db/schema/moments.js';
import { users } from '../db/schema/users.js';
import type { AppConfig } from '../secrets/config.js';
import { sendEmail } from './resend.js';
import { now as clockNow } from '../clock.js';

/**
 * Proactive email (P2.2, P2.6) — the only path for follow-ups and nudges,
 * and it goes through the existing Resend transport (Hard Rule 5).
 *
 * Guards, in order (decision D4: email only, opt-in, max 2 a week, quiet
 * hours by timezone):
 *   1. The leader opted in to this kind and has not unsubscribed from all.
 *   2. Frequency cap: at most 2 proactive emails in any rolling 7 days.
 *   3. Quiet hours in the leader's timezone (default 21:00–08:00).
 *   4. Idempotency: a unique key per logical email in `email_sends`
 *      (claimed before sending) plus Resend's Idempotency-Key header.
 * Every email carries a signed one-click unsubscribe link.
 *
 * Demo mode never sends: the email is "captured" into an in-memory outbox
 * the demo UI can show.
 */

export type ProactiveKind = 'followup' | 'weekly_nudge';
export const WEEKLY_CAP = 2;

export type SendDecision =
  | { outcome: 'sent' | 'captured'; messageId?: string }
  | { outcome: 'duplicate' }
  | { outcome: 'not_opted_in' }
  | { outcome: 'capped'; retryAt: Date }
  | { outcome: 'quiet_hours'; retryAt: Date }
  | { outcome: 'failed'; reason: string };

export interface CapturedEmail {
  to: string;
  subject: string;
  text: string;
  kind: ProactiveKind;
  at: string;
}
const outbox: CapturedEmail[] = [];
export function demoOutbox(): CapturedEmail[] {
  return [...outbox].reverse();
}
export function clearDemoOutboxForTests(): void {
  outbox.length = 0;
}

// ---- signed links --------------------------------------------------------

function linkSecret(config: AppConfig): string {
  const s = config.emailLinkSecret ?? config.encryptionKeyBase64;
  if (s === undefined || s === '') throw new Error('EMAIL_LINK_SECRET not configured');
  return s;
}

export function signLink(config: AppConfig, purpose: string, id: string): string {
  return createHmac('sha256', linkSecret(config)).update(`${purpose}:${id}`).digest('base64url');
}

export function verifyLink(config: AppConfig, purpose: string, id: string, token: string): boolean {
  const expected = Buffer.from(signLink(config, purpose, id));
  const got = Buffer.from(token);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export function unsubscribeUrl(config: AppConfig, userId: string): string {
  const base = config.publicBaseUrl ?? 'http://localhost:3000';
  return `${base}/api/email/unsubscribe?u=${userId}&t=${signLink(config, 'unsub', userId)}`;
}

// ---- time helpers --------------------------------------------------------

/** Local wall-clock hour (0–23) for `at` in IANA zone `tz` (UTC on bad tz). */
export function localHour(at: Date, tz: string | null | undefined): number {
  try {
    const h = new Intl.DateTimeFormat('en-US', {
      timeZone: tz ?? 'UTC',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(at);
    return Number.parseInt(h, 10) % 24;
  } catch {
    return at.getUTCHours();
  }
}

export function inQuietHours(hour: number, start: number, end: number): boolean {
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

/** First instant at or after `from` whose local hour is `hour` (searches hourly, 48h). */
export function nextLocalHour(from: Date, tz: string | null | undefined, hour: number): Date {
  const t = new Date(from);
  t.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 48; i++) {
    if (t.getTime() >= from.getTime() && localHour(t, tz) === hour) return t;
    t.setUTCHours(t.getUTCHours() + 1);
  }
  return new Date(from.getTime() + 12 * 3600_000);
}

/** "One follow-up on Friday" for a Thursday moment: next local 09:00 after it ends. */
export function followUpTime(happensAt: Date, tz: string | null | undefined): Date {
  return nextLocalHour(new Date(happensAt.getTime() + 2 * 3600_000), tz, 9);
}

// ---- prefs ----------------------------------------------------------------

export interface Prefs {
  followupEmailOptIn: boolean;
  weeklyNudgeOptIn: boolean;
  unsubscribedAll: boolean;
  quietStartHour: number;
  quietEndHour: number;
}

export async function getPrefs(db: Database, userId: string): Promise<Prefs> {
  const r = (
    await db.select().from(notificationPrefs).where(eq(notificationPrefs.userId, userId)).limit(1)
  )[0];
  return {
    followupEmailOptIn: r?.followupEmailOptIn ?? false,
    weeklyNudgeOptIn: r?.weeklyNudgeOptIn ?? false,
    unsubscribedAll: r?.unsubscribedAllAt !== null && r?.unsubscribedAllAt !== undefined,
    quietStartHour: r?.quietStartHour ?? 21,
    quietEndHour: r?.quietEndHour ?? 8,
  };
}

export async function setPrefs(
  db: Database,
  userId: string,
  patch: Partial<{ followupEmailOptIn: boolean; weeklyNudgeOptIn: boolean }>,
): Promise<Prefs> {
  const values = {
    userId,
    ...patch,
    // Opting in to anything clears a previous unsubscribe-all.
    ...(patch.followupEmailOptIn === true || patch.weeklyNudgeOptIn === true
      ? { unsubscribedAllAt: null }
      : {}),
    updatedAt: new Date(),
  };
  await db
    .insert(notificationPrefs)
    .values(values)
    .onConflictDoUpdate({ target: notificationPrefs.userId, set: values });
  return getPrefs(db, userId);
}

export async function unsubscribeAll(db: Database, userId: string): Promise<void> {
  const values = {
    userId,
    followupEmailOptIn: false,
    weeklyNudgeOptIn: false,
    unsubscribedAllAt: new Date(),
    updatedAt: new Date(),
  };
  await db
    .insert(notificationPrefs)
    .values(values)
    .onConflictDoUpdate({ target: notificationPrefs.userId, set: values });
}

// ---- send -------------------------------------------------------------------

export interface ProactiveEmail {
  userId: string;
  kind: ProactiveKind;
  /** Stable per logical email, e.g. `followup:<momentId>`. */
  idempotencyKey: string;
  subject: string;
  /** Body WITHOUT the unsubscribe footer (added here). */
  text: string;
  now?: Date;
}

export async function sendProactiveEmail(
  config: AppConfig,
  db: Database,
  email: ProactiveEmail,
): Promise<SendDecision> {
  const now = email.now ?? clockNow();
  const prefs = await getPrefs(db, email.userId);
  const optedIn = email.kind === 'followup' ? prefs.followupEmailOptIn : prefs.weeklyNudgeOptIn;
  if (!optedIn || prefs.unsubscribedAll) return { outcome: 'not_opted_in' };

  const u = (
    await db
      .select({ email: users.email, timezone: users.timezone })
      .from(users)
      .where(eq(users.id, email.userId))
      .limit(1)
  )[0];
  if (u === undefined || u.email === null || u.email === '') {
    return { outcome: 'failed', reason: 'no_address' };
  }

  // Duplicate? (checked before the cap so a retry of a sent email is a no-op)
  const prior = await db
    .select({ status: emailSends.status })
    .from(emailSends)
    .where(eq(emailSends.idempotencyKey, email.idempotencyKey))
    .limit(1);
  if (prior[0] !== undefined && prior[0].status !== 'failed') return { outcome: 'duplicate' };

  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);
  const recent = await db
    .select({ createdAt: emailSends.createdAt })
    .from(emailSends)
    .where(
      and(
        eq(emailSends.userId, email.userId),
        gte(emailSends.createdAt, weekAgo),
        inArray(emailSends.status, ['sent', 'captured', 'sending']),
      ),
    );
  if (recent.length >= WEEKLY_CAP) {
    const oldest = recent.map((r) => r.createdAt.getTime()).sort((a, b) => a - b)[0]!;
    return { outcome: 'capped', retryAt: new Date(oldest + 7 * 24 * 3600_000 + 60_000) };
  }

  const hour = localHour(now, u.timezone);
  if (inQuietHours(hour, prefs.quietStartHour, prefs.quietEndHour)) {
    return { outcome: 'quiet_hours', retryAt: nextLocalHour(now, u.timezone, prefs.quietEndHour) };
  }

  // Claim the idempotency key (unique index) before sending.
  if (prior[0]?.status === 'failed') {
    await db.delete(emailSends).where(eq(emailSends.idempotencyKey, email.idempotencyKey));
  }
  const claimed = await db
    .insert(emailSends)
    .values({
      userId: email.userId,
      kind: email.kind,
      idempotencyKey: email.idempotencyKey,
      status: 'sending',
      createdAt: now,
    })
    .onConflictDoNothing({ target: emailSends.idempotencyKey })
    .returning({ id: emailSends.id });
  if (claimed[0] === undefined) return { outcome: 'duplicate' };

  const unsub = unsubscribeUrl(config, email.userId);
  const text = `${email.text}\n\n—\nYou get this because you turned on email check-ins in Hogaan. One click to stop all of them: ${unsub}`;
  const html = text
    .split('\n')
    .map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .map((l) => l.replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>'))
    .join('<br>');

  if (config.demoMode === true) {
    outbox.push({
      to: u.email,
      subject: email.subject,
      text,
      kind: email.kind,
      at: now.toISOString(),
    });
    await db
      .update(emailSends)
      .set({ status: 'captured', updatedAt: new Date() })
      .where(eq(emailSends.id, claimed[0].id));
    return { outcome: 'captured' };
  }

  const res = await sendEmail(config, {
    to: u.email,
    subject: email.subject,
    text,
    html,
    source: `Proactive.${email.kind}`,
    idempotencyKey: email.idempotencyKey,
    headers: {
      'List-Unsubscribe': `<${unsub}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });
  await db
    .update(emailSends)
    .set({
      status: res.ok ? 'sent' : 'failed',
      providerMessageId: res.messageId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(emailSends.id, claimed[0].id));
  return res.ok
    ? { outcome: 'sent', ...(res.messageId !== undefined ? { messageId: res.messageId } : {}) }
    : { outcome: 'failed', reason: res.reason ?? 'unknown' };
}
