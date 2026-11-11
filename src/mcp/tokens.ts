import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { mcpTokens } from '../shared/db/schema/mcp-tokens.js';

/**
 * P3.1 — sign-in for a leader's own AI assistant: a personal access token
 * the leader creates on their Profile, shown once, stored only as SHA-256,
 * revocable. (OAuth 2.1 per the MCP authorization spec is the long-term
 * route — see the build report — but most assistants accept a bearer token.)
 */
export const TOKEN_PREFIX = 'hgn_';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createToken(
  db: Database,
  userId: string,
  label: string,
): Promise<{ id: string; token: string }> {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const rows = await db
    .insert(mcpTokens)
    .values({ userId, tokenHash: hashToken(token), label: label.slice(0, 60) || 'My assistant' })
    .returning({ id: mcpTokens.id });
  return { id: rows[0]!.id, token };
}

export async function listTokens(db: Database, userId: string) {
  return db
    .select({
      id: mcpTokens.id,
      label: mcpTokens.label,
      createdAt: mcpTokens.createdAt,
      lastUsedAt: mcpTokens.lastUsedAt,
    })
    .from(mcpTokens)
    .where(and(eq(mcpTokens.userId, userId), isNull(mcpTokens.revokedAt)))
    .orderBy(desc(mcpTokens.createdAt));
}

export async function revokeToken(db: Database, userId: string, id: string): Promise<boolean> {
  const r = await db
    .update(mcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(mcpTokens.id, id), eq(mcpTokens.userId, userId), isNull(mcpTokens.revokedAt)))
    .returning({ id: mcpTokens.id });
  return r[0] !== undefined;
}

/** Bearer token -> userId, or null. Updates last_used_at. */
export async function resolveToken(db: Database, token: string): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
  const r = (
    await db
      .select({ id: mcpTokens.id, userId: mcpTokens.userId })
      .from(mcpTokens)
      .where(and(eq(mcpTokens.tokenHash, hashToken(token)), isNull(mcpTokens.revokedAt)))
      .limit(1)
  )[0];
  if (r === undefined) return null;
  await db.update(mcpTokens).set({ lastUsedAt: new Date() }).where(eq(mcpTokens.id, r.id));
  return r.userId;
}
