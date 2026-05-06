import { voiceRulesV1 } from '../libraries/seed/voice-rules.js';
import { embedQuery } from '../shared/embeddings/index.js';
import type { AppConfig } from '../shared/secrets/config.js';
import type { CheckResult } from './types.js';

/**
 * Phase 11 R15 — voice-consistency check via cosine similarity.
 *
 * Embed the candidate response with voyage-3 (1024-dim), compare cosine
 * similarity against the centroid of voice_rules positiveExamples. Below
 * the threshold = soft_fail with the score embedded in the reason for
 * later analysis.
 *
 * Threshold chosen at 0.65 — empirically the gap between "Hamse-voice
 * positive examples" and the rest of the leadership-coaching corpus.
 * Calibration is conservative: voice is a soft check; we want misses
 * over false positives.
 *
 * The voice centroid is computed on first call and memoized; the module
 * lifetime is the process lifetime, so a v2 voice_rules promotion via
 * library publish triggers a process restart, which clears the memo
 * naturally. (If a soft-restart-without-promotion is added later, this
 * memo needs explicit invalidation.)
 */

const VOICE_CONSISTENCY_THRESHOLD = 0.65;

let voiceCentroidCache: { samples: number; centroid: number[] } | null = null;

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    s += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return s;
}

function magnitude(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

function cosineSimilarity(a: number[], b: number[]): number {
  const ma = magnitude(a);
  const mb = magnitude(b);
  if (ma === 0 || mb === 0) {
    return 0;
  }
  return dot(a, b) / (ma * mb);
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) {
    return [];
  }
  const dim = vectors[0]!.length;
  const out = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i += 1) {
      out[i] = (out[i] ?? 0) + (v[i] ?? 0);
    }
  }
  for (let i = 0; i < dim; i += 1) {
    out[i] = (out[i] ?? 0) / vectors.length;
  }
  return out;
}

/**
 * Compute (or return cached) centroid of all voice_rules positiveExamples.
 * Each example is a separate Voyage embed call; chunked at the embedQuery
 * level. Total: ~10 examples × ~80 tokens = ~800 tokens of embedding
 * traffic on first call only.
 */
async function getVoiceCentroid(config: AppConfig): Promise<number[]> {
  if (voiceCentroidCache !== null) {
    return voiceCentroidCache.centroid;
  }
  const samples: string[] = [];
  for (const rule of voiceRulesV1.rules) {
    for (const example of rule.positiveExamples) {
      samples.push(example);
    }
  }
  const vectors: number[][] = [];
  for (const s of samples) {
    vectors.push(await embedQuery(config, s));
  }
  const centroid = averageVectors(vectors);
  voiceCentroidCache = { samples: samples.length, centroid };
  return centroid;
}

/**
 * Run the voice-consistency check.
 *
 * Returns soft_fail when cosine(candidate, centroid) < threshold;
 * service_unavailable on embedding error (the QC orchestrator skips this
 * check on service_unavailable rather than failing the response — voice
 * consistency is shaping, not safety).
 */
export async function checkVoiceConsistency(
  config: AppConfig,
  candidate: string,
): Promise<CheckResult> {
  try {
    const [candidateVec, centroid] = await Promise.all([
      embedQuery(config, candidate),
      getVoiceCentroid(config),
    ]);
    const sim = cosineSimilarity(candidateVec, centroid);
    if (sim < VOICE_CONSISTENCY_THRESHOLD) {
      return {
        checkId: 'check_13_voice_consistency',
        outcome: {
          status: 'soft_fail',
          reason: `voice cosine ${sim.toFixed(3)} < ${VOICE_CONSISTENCY_THRESHOLD}`,
        },
      };
    }
    return { checkId: 'check_13_voice_consistency', outcome: { status: 'pass' } };
  } catch (err) {
    return {
      checkId: 'check_13_voice_consistency',
      outcome: {
        status: 'service_unavailable',
        reason: err instanceof Error ? err.message : 'embedding error',
      },
    };
  }
}

/** Test seam — clear the centroid cache between unit tests. */
export function _resetVoiceCentroidCache(): void {
  voiceCentroidCache = null;
}

/**
 * Phase 12 R10 — public cache invalidation hook.
 *
 * The library cache (src/libraries/resolver.ts) calls this when a new
 * voice_rules version is published, so checkVoiceConsistency picks up
 * the new positiveExamples on the next call. Without this coupling, the
 * centroid would persist across a v1 → v2 publish and the check would
 * score against stale Hamse-voice samples.
 *
 * Same body as _resetVoiceCentroidCache; named differently to make the
 * coupling visible.
 */
export function invalidateVoiceCentroidCache(): void {
  voiceCentroidCache = null;
}

export const _internal = {
  cosineSimilarity,
  averageVectors,
  VOICE_CONSISTENCY_THRESHOLD,
};
