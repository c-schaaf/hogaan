import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateLibraryCache } from '../../src/libraries/resolver.js';
import {
  _resetVoiceCentroidCache,
  checkVoiceConsistency,
  invalidateVoiceCentroidCache,
} from '../../src/quality-check/voice-consistency.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

vi.mock('../../src/shared/embeddings/index.js', () => ({
  embedQuery: vi.fn(),
}));

const cfg = { logLevel: 'error' } as AppConfig;

beforeEach(() => {
  _resetVoiceCentroidCache();
});

describe('Phase 12 R10 — voice centroid cache invalidates with library cache', () => {
  it('invalidateLibraryCache also clears the voice centroid', async () => {
    const { embedQuery } = await import('../../src/shared/embeddings/index.js');
    let callIndex = 0;
    vi.mocked(embedQuery).mockImplementation(() => {
      callIndex += 1;
      // Each call returns a vector that depends on call index, so successive
      // centroid recomputations produce DIFFERENT cached centroids.
      return Promise.resolve(callIndex === 1 ? [1, 0, 0, 0] : [0, 1, 0, 0]);
    });

    // First call computes centroid (caches it).
    const r1 = await checkVoiceConsistency(cfg, 'first');
    expect(r1.checkId).toBe('check_13_voice_consistency');
    const callsBeforeInvalidate = callIndex;

    // Second call uses the cache — only one new embed call (the candidate),
    // not re-embedding all the centroid samples.
    await checkVoiceConsistency(cfg, 'second');
    expect(callIndex - callsBeforeInvalidate).toBe(1);

    // Invalidate.
    invalidateLibraryCache();
    // Wait a tick for the lazy-import side effect to run.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Third call must re-embed the centroid samples (>1 new embed call).
    const before3 = callIndex;
    await checkVoiceConsistency(cfg, 'third');
    expect(callIndex - before3).toBeGreaterThan(1);
  });

  it('invalidateVoiceCentroidCache directly clears (test seam parity)', async () => {
    const { embedQuery } = await import('../../src/shared/embeddings/index.js');
    vi.mocked(embedQuery).mockResolvedValue([1, 0, 0, 0]);

    await checkVoiceConsistency(cfg, 'first');
    invalidateVoiceCentroidCache();
    const before = vi.mocked(embedQuery).mock.calls.length;
    await checkVoiceConsistency(cfg, 'second');
    // Must re-embed the centroid samples; expect more than 1 new call.
    expect(vi.mocked(embedQuery).mock.calls.length - before).toBeGreaterThan(1);
  });
});
