import { sql } from 'drizzle-orm';
import { asDate } from '../shared/db/dates.js';
import type { Database } from '../shared/db/client.js';
import { embedQuery } from '../shared/embeddings/index.js';
import type { AppConfig } from '../shared/secrets/config.js';
import type { UserId } from '../shared/types/index.js';
import type { MemorySearchResult } from './types.js';

/**
 * Process #8 §read. Embeds the query, runs a cosine-similarity search against
 * `memories.embedding` filtered by userId, returns the top-N most similar.
 *
 * pgvector cosine distance operator is `<=>`. Similarity = 1 - distance.
 * The HNSW index on the column accelerates this. We order by raw distance
 * ascending (smallest distance = most similar).
 *
 * The DB is the source of truth — no in-process cache. Latency budget per
 * Process #2 §5a is ~250ms; HNSW puts us comfortably under that for our scale.
 */

const DEFAULT_TOP_N = 5;

export async function retrieveMemories(
  config: AppConfig,
  db: Database,
  userId: UserId,
  queryText: string,
  topN: number = DEFAULT_TOP_N,
): Promise<MemorySearchResult[]> {
  if (topN <= 0) {
    return [];
  }
  const queryVec = await embedQuery(config, queryText);
  const vecLiteral = `[${queryVec.join(',')}]`;

  const rows = await db.execute<{
    id: string;
    content: string;
    metadata: Record<string, unknown> | null;
    similarity: string;
    created_at: Date;
  }>(sql`
    SELECT id, content, metadata,
           1 - (embedding <=> ${vecLiteral}::vector) AS similarity,
           created_at
    FROM memories
    WHERE user_id = ${userId}
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${vecLiteral}::vector
    LIMIT ${topN}
  `);

  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    similarity: Number.parseFloat(r.similarity),
    metadata: r.metadata,
    // postgres-js returns timestamp columns as ISO strings; coerce at the
    // boundary so callers get a real Date (matches MemorySearchResult typing).
    createdAt: asDate(r.created_at),
  }));
}
