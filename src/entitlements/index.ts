import { and, count, eq, gte } from 'drizzle-orm';
import { hasSponsoredSeat } from '../orgs/sponsorship.js';
import { now as clockNow } from '../shared/clock.js';
import type { Database } from '../shared/db/client.js';
import { subscriptions } from '../shared/db/schema/billing.js';
import { sessions } from '../shared/db/schema/sessions.js';
import { isEnabled } from '../shared/flags/index.js';
import type { AppConfig } from '../shared/secrets/config.js';

/**
 * P4.2 — every entitlement decision is made here, in one place.
 *
 * Plans (D1): Free, Personal ($20/month, Stripe), Sponsored (a seat in a
 * funded cohort — Phase 5).
 *
 * P4.3 — Free limits sessions, not quality: the same coach, model and
 * memory; 3 new sessions a calendar month; no follow-up emails, no MCP, no
 * connections. Continuing an existing session is never blocked.
 *
 * While FEATURE_BILLING is off there are no plans: everything is granted
 * and unlimited (today's behaviour).
 */
export type Plan = 'free' | 'personal' | 'sponsored';
export type Capability = 'mcp' | 'followUps' | 'connections' | 'unlimitedSessions';

export const FREE_SESSIONS_PER_MONTH = 3;
const PAID_STATUSES = new Set(['active', 'trialing', 'past_due']);

const CAPS: Record<Plan, Record<Capability, boolean>> = {
  free: { mcp: false, followUps: false, connections: false, unlimitedSessions: false },
  personal: { mcp: true, followUps: true, connections: true, unlimitedSessions: true },
  sponsored: { mcp: true, followUps: true, connections: true, unlimitedSessions: true },
};

export async function planFor(config: AppConfig, db: Database, userId: string): Promise<Plan> {
  const sub = (
    await db
      .select({ plan: subscriptions.plan, status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1)
  )[0];
  if (sub !== undefined && sub.plan === 'personal' && PAID_STATUSES.has(sub.status)) {
    return 'personal';
  }
  if (isEnabled(config, 'orgs') && (await hasSponsoredSeat(config, db, userId))) return 'sponsored';
  return 'free';
}

export async function hasCapability(
  config: AppConfig,
  db: Database,
  userId: string,
  cap: Capability,
): Promise<boolean> {
  if (!isEnabled(config, 'billing')) return true;
  return CAPS[await planFor(config, db, userId)][cap];
}

export function monthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

export async function sessionsThisMonth(
  db: Database,
  userId: string,
  at = clockNow(),
): Promise<number> {
  const r = await db
    .select({ n: count() })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gte(sessions.startedAt, monthStart(at))));
  return Number(r[0]?.n ?? 0);
}

export interface SessionAllowance {
  allowed: boolean;
  used: number;
  limit: number | null;
}

/** Called before a NEW session is created. */
export async function newSessionAllowance(
  config: AppConfig,
  db: Database,
  userId: string,
): Promise<SessionAllowance> {
  if (await hasCapability(config, db, userId, 'unlimitedSessions')) {
    return { allowed: true, used: 0, limit: null };
  }
  const used = await sessionsThisMonth(db, userId);
  return { allowed: used < FREE_SESSIONS_PER_MONTH, used, limit: FREE_SESSIONS_PER_MONTH };
}

export async function entitlementSummary(config: AppConfig, db: Database, userId: string) {
  const billing = isEnabled(config, 'billing');
  const plan = billing ? await planFor(config, db, userId) : 'personal';
  const caps = billing ? CAPS[plan] : CAPS.personal;
  const sub = (
    await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1)
  )[0];
  return {
    billing,
    plan,
    capabilities: caps,
    sessionsUsedThisMonth: await sessionsThisMonth(db, userId),
    sessionLimit: caps.unlimitedSessions ? null : FREE_SESSIONS_PER_MONTH,
    status: sub?.status ?? null,
    currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
  };
}
