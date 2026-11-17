import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../../shared/db/client.js';
import { mcpOAuthGrants } from '../../shared/db/schema/mcp-oauth.js';
import { users } from '../../shared/db/schema/users.js';
import { DEMO_SUPABASE_USER_ID } from '../../web-api/supabase-session.js';

/**
 * Store for "Sign in with Hogaan" connections (one row per connected
 * assistant). See seal.ts for why tokens are signed AND checked here.
 */
export type Grant = typeof mcpOAuthGrants.$inferSelect;

export interface NewGrant {
  id?: string;
  userId: string;
  clientKey: string;
  clientName: string;
  redirectHost: string;
  scope: string;
  codeJti: string;
  refreshJtiHash: string;
}

/** Insert; returns null when this code was already exchanged (unique code_jti). */
export async function createGrant(db: Database, g: NewGrant): Promise<string | null> {
  const rows = await db
    .insert(mcpOAuthGrants)
    .values(g)
    .onConflictDoNothing({ target: mcpOAuthGrants.codeJti })
    .returning({ id: mcpOAuthGrants.id });
  return rows[0]?.id ?? null;
}

export async function getGrant(db: Database, id: string): Promise<Grant | null> {
  const rows = await db.select().from(mcpOAuthGrants).where(eq(mcpOAuthGrants.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function grantByCode(db: Database, codeJti: string): Promise<Grant | null> {
  const rows = await db
    .select()
    .from(mcpOAuthGrants)
    .where(eq(mcpOAuthGrants.codeJti, codeJti))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Rotate the refresh token: succeeds only if `expectedHash` is still the
 * current one (so two refreshes with the same token cannot both win).
 */
export async function rotateRefresh(
  db: Database,
  id: string,
  expectedHash: string,
  nextHash: string,
  presentedHash: string = expectedHash,
  opts: { keepRotatedAt?: boolean } = {},
): Promise<boolean> {
  const rows = await db
    .update(mcpOAuthGrants)
    .set({
      refreshJtiHash: nextHash,
      // The token actually presented (differs from expectedHash only for a
      // demo grant rebuilt after a restart), so a quick retry with it is
      // recognised as a retry.
      prevRefreshJtiHash: presentedHash,
      ...(opts.keepRotatedAt === true ? {} : { rotatedAt: new Date() }),
      lastUsedAt: new Date(),
    })
    .where(
      and(
        eq(mcpOAuthGrants.id, id),
        eq(mcpOAuthGrants.refreshJtiHash, expectedHash),
        isNull(mcpOAuthGrants.revokedAt),
      ),
    )
    .returning({ id: mcpOAuthGrants.id });
  return rows[0] !== undefined;
}

/** Revoke. With `userId`, only that leader's own grant. */
export async function revokeGrant(db: Database, id: string, userId?: string): Promise<boolean> {
  const rows = await db
    .update(mcpOAuthGrants)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(mcpOAuthGrants.id, id),
        isNull(mcpOAuthGrants.revokedAt),
        ...(userId !== undefined ? [eq(mcpOAuthGrants.userId, userId)] : []),
      ),
    )
    .returning({ id: mcpOAuthGrants.id });
  return rows[0] !== undefined;
}

export async function touchGrant(db: Database, id: string): Promise<void> {
  await db.update(mcpOAuthGrants).set({ lastUsedAt: new Date() }).where(eq(mcpOAuthGrants.id, id));
}

export async function listGrants(db: Database, userId: string) {
  return db
    .select({
      id: mcpOAuthGrants.id,
      clientName: mcpOAuthGrants.clientName,
      redirectHost: mcpOAuthGrants.redirectHost,
      createdAt: mcpOAuthGrants.createdAt,
      lastUsedAt: mcpOAuthGrants.lastUsedAt,
    })
    .from(mcpOAuthGrants)
    .where(and(eq(mcpOAuthGrants.userId, userId), isNull(mcpOAuthGrants.revokedAt)))
    .orderBy(desc(mcpOAuthGrants.createdAt));
}

/**
 * DEMO MODE ONLY. A hosted demo rebuilds its in-memory database whenever
 * the service sleeps, so a connected assistant's grant row disappears while
 * its signed tokens are still valid. Recreate the row (same id) for the
 * sample leader, who is the only person a demo token can ever name.
 *
 * Never called outside demo mode: in the real app a missing row means the
 * connection does not exist, and the token is refused.
 *
 * Known demo-only limit: "Disconnect" in a hosted demo lasts until the next
 * restart, because the revocation lived in the rebuilt database too.
 */
export async function rehydrateDemoGrant(
  db: Database,
  g: Omit<NewGrant, 'userId'> & { id: string },
): Promise<Grant | null> {
  const leader = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.supabaseUserId, DEMO_SUPABASE_USER_ID))
      .limit(1)
  )[0];
  if (leader === undefined) return null;
  await db
    .insert(mcpOAuthGrants)
    .values({ ...g, userId: leader.id })
    .onConflictDoNothing();
  return getGrant(db, g.id);
}
