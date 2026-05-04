import type { AppConfig } from '../secrets/config.js';
import { voyageEmbed } from '../llm/voyage.js';

/**
 * Embedding helper: thin facade over the Voyage client. All embeddings in the
 * Hogaan corpus are 1024-dim from voyage-3-lite (CLAUDE.md / PRD §6).
 *
 * `inputType` discipline: documents (memories, scenarios, library content) use
 * 'document' so Voyage's domain prompt biases for retrieval-corpus shape.
 * Live user messages going against the index use 'query'. Mixing them
 * silently degrades recall.
 *
 * Batch ceiling: Voyage accepts ~128 inputs per request. We chunk transparently.
 */

export const EMBEDDING_DIM = 1024;
const VOYAGE_BATCH_LIMIT = 128;
const DEFAULT_TIMEOUT_MS = 8000;

export async function embedQuery(
  config: AppConfig,
  text: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<number[]> {
  const res = await voyageEmbed(config, {
    model: 'voyage-3-lite',
    texts: [text],
    inputType: 'query',
    timeoutMs,
  });
  const v = res.embeddings[0];
  if (v === undefined) {
    throw new Error('voyage returned no embedding for query');
  }
  if (v.length !== EMBEDDING_DIM) {
    throw new Error(`voyage returned dim=${v.length}; expected ${EMBEDDING_DIM}`);
  }
  return v;
}

export async function embedDocument(
  config: AppConfig,
  text: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<number[]> {
  const [v] = await embedDocuments(config, [text], timeoutMs);
  if (v === undefined) {
    throw new Error('voyage returned no embedding for document');
  }
  return v;
}

export async function embedDocuments(
  config: AppConfig,
  texts: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const out: number[][] = new Array<number[]>(texts.length);
  for (let offset = 0; offset < texts.length; offset += VOYAGE_BATCH_LIMIT) {
    const slice = texts.slice(offset, offset + VOYAGE_BATCH_LIMIT);
    const res = await voyageEmbed(config, {
      model: 'voyage-3-lite',
      texts: slice,
      inputType: 'document',
      timeoutMs,
    });
    if (res.embeddings.length !== slice.length) {
      throw new Error(
        `voyage returned ${res.embeddings.length} embeddings for ${slice.length} inputs`,
      );
    }
    for (let i = 0; i < slice.length; i++) {
      const emb = res.embeddings[i];
      if (emb === undefined || emb.length !== EMBEDDING_DIM) {
        throw new Error(`voyage embedding ${offset + i} has wrong dim`);
      }
      out[offset + i] = emb;
    }
  }
  return out;
}
