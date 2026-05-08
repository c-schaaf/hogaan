import { afterEach, describe, expect, it, vi } from 'vitest';
import { _internal, chunkBody, sendChunkedBody } from '../../src/whatsapp-delivery/chunk.js';
import type { ChunkDispatcher } from '../../src/whatsapp-delivery/chunk.js';
import type { OutboundRequest, OutboundResult } from '../../src/whatsapp-delivery/types.js';

/**
 * 2026-05-08 — Twilio WhatsApp sandbox silently drops messages over ~1600
 * characters. Smoke-trace evidence:
 *   - 4:32 PM coaching turn, bodyLen 1734 → no Twilio outgoing entry, never delivered.
 *   - 4:40 PM coaching turn, bodyLen ~1481 → delivered cleanly.
 *   - 4:31 PM greeting,    bodyLen 881   → delivered cleanly.
 * The chunking helper splits oversized bodies along structural boundaries
 * and dispatches each chunk independently with its own correlationId.
 */

afterEach(() => {
  vi.clearAllMocks();
});

describe('chunkBody — pure helper', () => {
  it('passes a sub-1500 body through as a single chunk (existing behavior unchanged)', () => {
    const body = 'Salaam. ' + 'short and sweet response. '.repeat(40); // ~1080 chars
    expect(body.length).toBeLessThanOrEqual(_internal.MAX_WHATSAPP_CHARS);
    const chunks = chunkBody(body);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(body);
  });

  it('splits the production 1734-char case into 2 chunks at a paragraph boundary', () => {
    // Reconstructed shape of the failing trace: two long paragraphs
    // separated by `\n\n`, total length 1734.
    const para1 = 'X'.repeat(1100);
    const para2 = 'Y'.repeat(1734 - 1100 - 2); // -2 for the \n\n separator
    const body = `${para1}\n\n${para2}`;
    expect(body.length).toBe(1734);

    const chunks = chunkBody(body);

    expect(chunks).toHaveLength(2);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(_internal.MAX_WHATSAPP_CHARS);
    }
    // The split landed at the paragraph break: chunk 1 is the X-paragraph,
    // chunk 2 is the Y-paragraph. The split point is preserved (no content
    // lost across the boundary).
    expect(chunks[0]).toMatch(/^X+$/);
    expect(chunks[1]).toMatch(/^Y+$/);
  });

  it('splits a 4500-char body with paragraph breaks into 3 chunks', () => {
    const para = 'P'.repeat(1490);
    const body = [para, para, para].join('\n\n'); // 1490*3 + 2*2 = 4474
    expect(body.length).toBeGreaterThan(_internal.MAX_WHATSAPP_CHARS * 2);

    const chunks = chunkBody(body);

    expect(chunks).toHaveLength(3);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(_internal.MAX_WHATSAPP_CHARS);
    }
  });

  it('falls back to sentence boundary when one paragraph exceeds the limit', () => {
    // Single paragraph (no \n\n, no \n) of 1700 chars made of repeated
    // short sentences. The first split MUST land at a sentence terminator
    // within the 1500-char window — never mid-sentence.
    const sentence = 'This is a coaching sentence. ';
    const reps = Math.ceil(1700 / sentence.length);
    const body = sentence.repeat(reps).slice(0, 1700);
    expect(body.length).toBe(1700);
    expect(body).not.toContain('\n');

    const chunks = chunkBody(body);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(_internal.MAX_WHATSAPP_CHARS);
    }
    // Chunk 1 must end at a sentence terminator, not mid-word.
    expect(chunks[0]).toMatch(/[.!?]$/);
  });
});

describe('sendChunkedBody — multi-Twilio dispatch with failure isolation', () => {
  const baseRequest: Omit<OutboundRequest, 'correlationId' | 'body'> = {
    callerProcessId: 'coaching:test',
    phoneE164: '+15551234567',
    messageType: 'FreeForm',
    priority: 'High',
  };

  const success = (waMessageId: string): OutboundResult => ({
    endEvent: 'E1_MessageDispatched',
    waMessageId,
    dispatchPath: 'direct',
    retryCount: 0,
    queueLoops: 0,
  });

  const transientFail = (): OutboundResult => ({
    endEvent: 'E13_TransientFailureExhausted',
    dispatchPath: 'failed',
    retryCount: 3,
    queueLoops: 0,
    reason: 'twilio_timeout_exhausted',
  });

  it('continues dispatching when chunk 2 of 3 fails, captures all 3 outcomes (failure isolation)', async () => {
    const dispatcher: ChunkDispatcher = vi
      .fn<ChunkDispatcher>()
      .mockResolvedValueOnce(success('SID-CHUNK-1'))
      .mockResolvedValueOnce(transientFail())
      .mockResolvedValueOnce(success('SID-CHUNK-3'));

    // 4500-char body produces 3 chunks per the chunkBody contract.
    const para = 'P'.repeat(1490);
    const body = [para, para, para].join('\n\n');

    const result = await sendChunkedBody(dispatcher, baseRequest, body, 'test-prefix', {
      interChunkDelayMs: 0,
    });

    expect(dispatcher).toHaveBeenCalledTimes(3);
    expect(result.totalChunks).toBe(3);
    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);
    expect(result.perChunkResults).toHaveLength(3);
    expect(result.perChunkResults[0]?.endEvent).toBe('E1_MessageDispatched');
    expect(result.perChunkResults[1]?.endEvent).toBe('E13_TransientFailureExhausted');
    expect(result.perChunkResults[2]?.endEvent).toBe('E1_MessageDispatched');
    // First success's SID is preserved for back-compat with single-message callers.
    expect(result.firstSuccessWaMessageId).toBe('SID-CHUNK-1');

    // Per-chunk correlationIds derived from the supplied prefix (idempotency-safe).
    const calls = vi.mocked(dispatcher).mock.calls;
    expect(calls[0]?.[0].correlationId).toBe('test-prefix-chunk1of3');
    expect(calls[1]?.[0].correlationId).toBe('test-prefix-chunk2of3');
    expect(calls[2]?.[0].correlationId).toBe('test-prefix-chunk3of3');
  });
});
