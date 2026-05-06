import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _internal,
  _resetVoiceCentroidCache,
  checkVoiceConsistency,
} from '../../src/quality-check/voice-consistency.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';

vi.mock('../../src/shared/embeddings/index.js', () => ({
  embedQuery: vi.fn(),
}));

const cfg = { logLevel: 'error' } as AppConfig;

beforeEach(() => {
  _resetVoiceCentroidCache();
});

describe('Phase 11 R15 — voice-consistency math', () => {
  it('cosineSimilarity returns 1 for identical vectors', () => {
    expect(_internal.cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it('cosineSimilarity returns 0 for orthogonal vectors', () => {
    expect(_internal.cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('cosineSimilarity is between -1 and 1', () => {
    const a = [0.5, 0.5, 0.5, 0.5];
    const b = [0.6, 0.4, 0.5, 0.5];
    const s = _internal.cosineSimilarity(a, b);
    expect(s).toBeGreaterThan(0.9);
    expect(s).toBeLessThan(1);
  });

  it('averageVectors element-wise mean', () => {
    expect(_internal.averageVectors([[1, 2], [3, 4]])).toEqual([2, 3]);
  });

  it('threshold is 0.65 (audit-prescribed)', () => {
    expect(_internal.VOICE_CONSISTENCY_THRESHOLD).toBe(0.65);
  });
});

describe('Phase 11 R15 — checkVoiceConsistency runtime', () => {
  it('passes when cosine ≥ threshold', async () => {
    const { embedQuery } = await import('../../src/shared/embeddings/index.js');
    // Always return the same vector so cosine = 1 (perfect match).
    vi.mocked(embedQuery).mockResolvedValue([1, 0, 0, 0]);

    const result = await checkVoiceConsistency(cfg, 'this is a candidate');
    expect(result.checkId).toBe('check_13_voice_consistency');
    expect(result.outcome.status).toBe('pass');
  });

  it('soft-fails when cosine is below threshold', async () => {
    const { embedQuery } = await import('../../src/shared/embeddings/index.js');
    // Two distinct calls: candidate (one vec), centroid samples (another).
    // First call = candidate query; subsequent calls = centroid samples.
    let callIndex = 0;
    vi.mocked(embedQuery).mockImplementation(() => {
      callIndex += 1;
      // Candidate is vector A; centroid samples are orthogonal vector B.
      // Cosine(A, mean(B,B,...)) = 0 < 0.65 → soft_fail.
      if (callIndex === 1) {
        return Promise.resolve([1, 0, 0, 0]);
      }
      return Promise.resolve([0, 1, 0, 0]);
    });

    const result = await checkVoiceConsistency(cfg, 'off-voice candidate');
    expect(result.outcome.status).toBe('soft_fail');
    if (result.outcome.status === 'soft_fail') {
      expect(result.outcome.reason).toMatch(/voice cosine.*< 0\.65/);
    }
  });

  it('returns service_unavailable when embedding fails', async () => {
    const { embedQuery } = await import('../../src/shared/embeddings/index.js');
    vi.mocked(embedQuery).mockRejectedValueOnce(new Error('voyage 503'));

    const result = await checkVoiceConsistency(cfg, 'whatever');
    expect(result.outcome.status).toBe('service_unavailable');
  });
});
