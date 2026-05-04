import type { Database } from '../shared/db/client.js';
import { memories } from '../shared/db/schema/memories.js';
import { embedDocument } from '../shared/embeddings/index.js';
import type { AppConfig } from '../shared/secrets/config.js';
import type { NewMemoryInput } from './types.js';

/**
 * Process #8 §write. Generates a 1024-dim Voyage embedding from `content`,
 * INSERTs a memories row with the embedding + metadata.
 *
 * pgvector wants the vector as a literal `[v1,v2,...]::vector` cast in SQL —
 * drizzle's vector column type stores it as `string` shape but accepts arrays
 * during insert via the postgres.js binding.
 */
export async function writeMemory(
  config: AppConfig,
  db: Database,
  input: NewMemoryInput,
): Promise<{ id: string }> {
  const embedding = await embedDocument(config, input.content);

  const metadata = {
    kind: input.kind,
    ...(input.extraMetadata ?? {}),
  };

  const inserted = await db
    .insert(memories)
    .values({
      userId: input.userId,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
      ...(input.turnId !== undefined ? { turnId: input.turnId } : {}),
      content: input.content,
      metadata,
      embedding,
    })
    .returning({ id: memories.id });

  if (inserted[0] === undefined) {
    throw new Error('memory insert returned no row');
  }
  return { id: inserted[0].id };
}
