import { randomUUID } from 'node:crypto';
import { reportIncident } from '../shared/observability/incidents.js';
import { asCorrelationId } from '../shared/types/index.js';
import type { OutboundRequest, OutboundResult } from './types.js';

/**
 * WhatsApp message-length chunking.
 *
 * Twilio's WhatsApp sandbox silently drops messages over ~1600 characters
 * (no Twilio API entry, no error — the message just never reaches the user).
 * Production WhatsApp Business API may differ but the same chunking model
 * works for both. RCA: 2026-05-08 smoke test where a 1734-char coaching
 * response (community-center turn) never delivered while a 1481-char turn
 * 8 minutes later delivered cleanly.
 *
 * `MAX_WHATSAPP_CHARS` is set to 1500 — a safety margin under the 1600
 * sandbox limit. `chunkBody` splits oversized bodies along structural
 * boundaries:
 *   1. paragraph break (`\n\n`) within the maxChars window — preferred
 *   2. line break (`\n`) within the window — secondary
 *   3. last sentence terminator (`.`, `!`, `?` followed by whitespace) — fallback for single
 *      paragraphs that exceed the limit
 *   4. hard cut at maxChars — only if no structural boundary exists
 *      (effectively dead branch for sane prose, kept defensively)
 *
 * `sendChunkedBody` orchestrates the multi-Twilio dispatch: per-chunk
 * correlationIds (idempotency-safe), 600ms inter-chunk delay (preserves
 * WhatsApp delivery order), per-chunk structured log emit, and chunk-level
 * error isolation (a single chunk failure does NOT abort subsequent chunks).
 */

export const MAX_WHATSAPP_CHARS = 1500;
const INTER_CHUNK_DELAY_MS = 600;

/**
 * Split `body` into <=maxChars segments along paragraph / line / sentence
 * boundaries. Returns the input as a single-element array when it already
 * fits.
 */
export function chunkBody(body: string, maxChars: number = MAX_WHATSAPP_CHARS): string[] {
  if (body.length <= maxChars) return [body];

  const chunks: string[] = [];
  let remaining = body;

  while (remaining.length > maxChars) {
    let splitAt = lastIndexBeforeMax(remaining, '\n\n', maxChars);
    if (splitAt <= 0) splitAt = lastIndexBeforeMax(remaining, '\n', maxChars);
    if (splitAt <= 0) splitAt = findLastSentenceBoundary(remaining, maxChars);
    if (splitAt <= 0) splitAt = maxChars;

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining.length > 0) chunks.push(remaining);

  return chunks;
}

function lastIndexBeforeMax(text: string, needle: string, maxChars: number): number {
  return text.lastIndexOf(needle, maxChars);
}

function findLastSentenceBoundary(text: string, maxChars: number): number {
  const slice = text.slice(0, maxChars);
  const re = /[.!?](?:\s|$)/g;
  let lastIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) {
    lastIdx = m.index + 1;
  }
  return lastIdx;
}

export interface ChunkedSendResult {
  totalChunks: number;
  successCount: number;
  failureCount: number;
  /** Twilio SID of the FIRST successful chunk — kept for back-compat with the legacy single-message return shape. */
  firstSuccessWaMessageId?: string;
  perChunkResults: OutboundResult[];
}

/**
 * Per-chunk dispatcher contract. Defaults to `sendOutbound` in production;
 * tests inject a mock. Decoupling from the orchestrator import keeps this
 * module free of the heavy idempotency/db/redis/rateLimiters deps for unit
 * testing.
 */
export type ChunkDispatcher = (request: OutboundRequest) => Promise<OutboundResult>;

export interface SendChunkedBodyOpts {
  /** Override the inter-chunk delay (production default 600ms; tests pass 0). */
  interChunkDelayMs?: number;
}

/**
 * Run `body` through `chunkBody`, then dispatch each chunk via the supplied
 * `dispatcher` (typically `sendOutbound`). Each chunk gets a derived
 * correlationId (`<prefix>-chunk{N}of{M}`) so Process #11's idempotency
 * store treats them as independent dispatches.
 *
 * Failure isolation: a chunk that fails does NOT short-circuit the loop —
 * subsequent chunks are still attempted and the failure is captured in
 * `perChunkResults`. The aggregate result is "succeeded" (failed=false at
 * the caller layer) iff at least one chunk succeeded.
 *
 * Per-chunk log: a structured stdout line (chunk-dispatched) for every
 * chunk, success or failure. The last "all chunks failed" case also emits
 * a P2 incident for trend visibility.
 */
export async function sendChunkedBody(
  dispatcher: ChunkDispatcher,
  baseRequest: Omit<OutboundRequest, 'correlationId' | 'body'>,
  body: string,
  correlationIdPrefix: string,
  opts: SendChunkedBodyOpts = {},
): Promise<ChunkedSendResult> {
  const interChunkDelayMs = opts.interChunkDelayMs ?? INTER_CHUNK_DELAY_MS;
  const chunks = chunkBody(body);
  const totalChunks = chunks.length;
  const perChunkResults: OutboundResult[] = [];
  let firstSuccessWaMessageId: string | undefined;

  for (let i = 0; i < totalChunks; i++) {
    const chunkText = chunks[i] ?? '';
    const chunkIndex = i + 1;
    const correlationId = asCorrelationId(
      `${correlationIdPrefix}-chunk${chunkIndex}of${totalChunks}`,
    );

    const r = await dispatcher({
      ...baseRequest,
      correlationId,
      body: chunkText,
    });
    perChunkResults.push(r);

    const succeeded = isDispatchSuccess(r);
    if (succeeded && firstSuccessWaMessageId === undefined && r.waMessageId !== undefined) {
      firstSuccessWaMessageId = r.waMessageId;
    }

    logChunkDelivery({
      chunkIndex,
      totalChunks,
      bodyLen: chunkText.length,
      ...(r.waMessageId !== undefined ? { waMessageId: r.waMessageId } : {}),
      endEvent: r.endEvent,
      status: succeeded ? 'success' : 'failure',
      ...(succeeded || r.reason === undefined ? {} : { reason: r.reason }),
    });

    if (!succeeded) {
      reportIncident('P2', 'whatsapp chunk delivery failed (continuing remaining chunks)', {
        source: 'Process_11.ChunkedSend',
        tags: { chunkIndex: String(chunkIndex), totalChunks: String(totalChunks) },
        extra: {
          chunkBodyLen: chunkText.length,
          endEvent: r.endEvent,
          reason: r.reason,
        },
      });
    }

    if (i < totalChunks - 1 && interChunkDelayMs > 0) {
      await sleep(interChunkDelayMs);
    }
  }

  const successCount = perChunkResults.filter(isDispatchSuccess).length;
  const failureCount = totalChunks - successCount;

  if (successCount === 0 && totalChunks > 0) {
    reportIncident('P1', 'whatsapp chunked send: all chunks failed', {
      source: 'Process_11.ChunkedSend',
      tags: { totalChunks: String(totalChunks) },
      extra: {
        bodyLen: body.length,
        firstFailureReason: perChunkResults[0]?.reason,
      },
    });
  }

  return {
    totalChunks,
    successCount,
    failureCount,
    ...(firstSuccessWaMessageId !== undefined ? { firstSuccessWaMessageId } : {}),
    perChunkResults,
  };
}

function isDispatchSuccess(r: OutboundResult): boolean {
  return (
    r.endEvent === 'E1_MessageDispatched' ||
    r.endEvent === 'E2_MessageDispatchedAfterRetry' ||
    r.endEvent === 'E5_DuplicateRequest'
  );
}

interface ChunkLogPayload {
  chunkIndex: number;
  totalChunks: number;
  bodyLen: number;
  waMessageId?: string;
  endEvent: string;
  status: 'success' | 'failure';
  reason?: string;
}

function logChunkDelivery(payload: ChunkLogPayload): void {
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      kind: 'whatsapp-chunk-dispatched',
      ...payload,
    }),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (typeof t.unref === 'function') {
      t.unref();
    }
  });
}

export const _internal = {
  MAX_WHATSAPP_CHARS,
  INTER_CHUNK_DELAY_MS,
  isDispatchSuccess,
  buildCorrelationId: (prefix: string) => asCorrelationId(`${prefix}-${randomUUID().slice(0, 6)}`),
};
