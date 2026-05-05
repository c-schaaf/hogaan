import { eq } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { users } from '../shared/db/schema/users.js';
import type { UserId } from '../shared/types/index.js';

/**
 * Daily-prompt opt-in is stored on `users.profile_flags.dailyPromptsOptedIn`.
 *
 * Default policy: opted IN (CLAUDE.md PRD §3 Feature 3 frames daily prompts as
 * a baseline behavior of the product, not a paid add-on). Users can opt out
 * via PRD-level "STOP" handling — the suppression list — and via this
 * narrower toggle which lets them keep coaching while turning off prompts.
 *
 * This file is a tiny module on purpose: callers should not poke
 * profile_flags directly.
 */

export const DAILY_PROMPT_OPT_IN_FLAG = 'dailyPromptsOptedIn';

/**
 * Read the opt-in state from a profile_flags blob (already-fetched row).
 * Default: opted IN. Explicit `false` opts out; missing flag = opted in.
 */
export function isOptedIn(profileFlags: unknown): boolean {
  if (profileFlags === null || profileFlags === undefined) {
    return true;
  }
  if (typeof profileFlags !== 'object') {
    return true;
  }
  const flag = (profileFlags as Record<string, unknown>)[DAILY_PROMPT_OPT_IN_FLAG];
  if (flag === false) {
    return false;
  }
  return true;
}

/**
 * Persist opt-in state. Merges into the existing profile_flags JSONB rather
 * than overwriting — other modules (onboarding, ops review) also write here.
 */
export async function setOptIn(db: Database, userId: UserId, optedIn: boolean): Promise<void> {
  const rows = await db
    .select({ profileFlags: users.profileFlags })
    .from(users)
    .where(eq(users.id, userId as unknown as string))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`setOptIn: user ${userId} not found`);
  }
  const existing =
    row.profileFlags !== null && typeof row.profileFlags === 'object'
      ? (row.profileFlags as Record<string, unknown>)
      : {};
  const merged = { ...existing, [DAILY_PROMPT_OPT_IN_FLAG]: optedIn };
  await db
    .update(users)
    .set({ profileFlags: merged })
    .where(eq(users.id, userId as unknown as string));
}

/** Convenience: read opt-in state by userId (one DB hit). */
export async function getOptIn(db: Database, userId: UserId): Promise<boolean> {
  const rows = await db
    .select({ profileFlags: users.profileFlags })
    .from(users)
    .where(eq(users.id, userId as unknown as string))
    .limit(1);
  return isOptedIn(rows[0]?.profileFlags ?? null);
}
