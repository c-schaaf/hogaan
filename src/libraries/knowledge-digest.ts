import { and, eq } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { libraryVersions } from '../shared/db/schema/library-versions.js';

/**
 * P1.4 — Layer 1 knowledge digest: a curated digest of *The Transformational
 * Leader* and the twelve practices, placed right after the system template
 * and prompt-cached (no extra step in the chat turn, so no latency).
 *
 * CONTENT IS HAMSE-OWNED (Hard Rule 2). This file is only the mechanism.
 * A digest is injected into prompts ONLY when:
 *   - FEATURE_KNOWLEDGE_DIGEST is on, AND
 *   - the active `knowledge_digest` library row has status 'approved' and
 *     names who approved it.
 * The placeholder below has status 'placeholder' and is never injected.
 */
export interface KnowledgeDigestPayload {
  status: 'placeholder' | 'approved';
  approvedBy?: string;
  approvedAt?: string;
  /** Prose digest placed in the cached system block. */
  text: string;
  /** Short per-practice excerpts (MCP get_practice_guidance, D6). */
  excerpts: { practice: string; text: string }[];
}

export const KNOWLEDGE_DIGEST_PLACEHOLDER: KnowledgeDigestPayload = {
  status: 'placeholder',
  text: '[PLACEHOLDER — awaiting founder-approved digest of The Transformational Leader. Not injected into prompts while status is "placeholder".]',
  excerpts: [],
};

const TTL_MS = 60_000;
let cache: { value: KnowledgeDigestPayload | null; expiresAt: number } | undefined;

export async function getActiveDigest(db: Database): Promise<KnowledgeDigestPayload | null> {
  const now = Date.now();
  if (cache !== undefined && cache.expiresAt > now) return cache.value;
  const rows = await db
    .select({ payload: libraryVersions.payload })
    .from(libraryVersions)
    .where(
      and(eq(libraryVersions.libraryName, 'knowledge_digest'), eq(libraryVersions.active, true)),
    )
    .limit(1);
  const value = (rows[0]?.payload as KnowledgeDigestPayload | undefined) ?? null;
  cache = { value, expiresAt: now + TTL_MS };
  return value;
}

/** The approved digest, or null (missing, placeholder, or no named approver). */
export async function getApprovedDigest(db: Database): Promise<KnowledgeDigestPayload | null> {
  const d = await getActiveDigest(db);
  if (d === null || d.status !== 'approved') return null;
  if (typeof d.approvedBy !== 'string' || d.approvedBy.trim() === '') return null;
  return d;
}

export function resetDigestCacheForTests(): void {
  cache = undefined;
}
