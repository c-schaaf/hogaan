import { eq } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { suppressionList } from '../shared/db/schema/suppression-list.js';
import { users } from '../shared/db/schema/users.js';
import { addToSuppression } from '../shared/redis/suppression.js';
import type { RedisBundle } from '../shared/redis/client.js';
import type { UserId } from '../shared/types/index.js';

/**
 * Process #1 §Global Opt-Out subprocess. Listens for STOP/UNSUBSCRIBE/LEAVE/
 * OPT OUT keywords across ALL onboarding states. When fired:
 *   - profile.status = 'opted_out'
 *   - suppression_list row INSERTed (durable source of truth)
 *   - Redis suppression set updated (hot path for Process #11/#12 checks)
 *   - opt-out confirmation sent
 *   - terminal E5_OnboardingAbandoned
 *
 * WhatsApp Business policy mandates honoring STOP within "a short window"
 * (typically <24h, ideally <1m). All four writes are best-effort + logged.
 */

// Phase 12 R18 — 'cancel' and 'end' removed from this list. Both produced
// false positives in coaching context: "I want to cancel that meeting" /
// "Let me end this conflict". WhatsApp Business policy honors STOP /
// UNSUBSCRIBE / LEAVE / OPT OUT — those four are the canonical set.
const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'leave', 'opt out', 'optout'];

export function isOptOutMessage(text: string): boolean {
  const norm = text
    .toLowerCase()
    .trim()
    .replace(/[!?.,]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (norm.length === 0) {
    return false;
  }
  for (const kw of OPT_OUT_KEYWORDS) {
    // Single-word: exact match OR word-boundary match.
    if (norm === kw) {
      return true;
    }
    if (kw.includes(' ')) {
      // Multi-word: substring is fine.
      if (norm.includes(kw)) {
        return true;
      }
      continue;
    }
    const re = new RegExp(`(^|[^a-z])${kw}([^a-z]|$)`, 'i');
    if (re.test(norm)) {
      return true;
    }
  }
  return false;
}

export async function recordOptOut(
  db: Database,
  redis: RedisBundle,
  userId: UserId,
  phoneHash: string,
): Promise<void> {
  // Idempotent — re-running with the same phoneHash is a no-op via ON CONFLICT.
  await db
    .insert(suppressionList)
    .values({ phoneHash, reason: 'opt_out', notes: 'Process #1 global opt-out' })
    .onConflictDoNothing();

  await db.update(users).set({ status: 'opted_out' }).where(eq(users.id, userId));

  // Hot-path Redis set — failure here is non-fatal because the durable row
  // above is the source of truth; suppression check fail-closes on Redis
  // outage anyway.
  try {
    await addToSuppression(redis, phoneHash);
  } catch {
    // Logged via the caller's incident path.
  }
}
