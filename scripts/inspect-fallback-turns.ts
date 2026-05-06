import 'dotenv/config';
import { desc } from 'drizzle-orm';
import { getDb } from '../src/shared/db/client.js';
import { libraryVersions } from '../src/shared/db/schema/library-versions.js';
import { turns } from '../src/shared/db/schema/turns.js';
import { voyageEmbed } from '../src/shared/llm/voyage.js';
import { voiceRulesV1 } from '../src/libraries/seed/voice-rules.js';
import { loadConfig } from '../src/shared/secrets/config.js';

/**
 * Phase 12 fallback diagnostic — read-only.
 *
 * Pulls the last N turns plus active library_versions, then for every
 * turn with a non-null responseText computes the Voyage cosine against
 * the current voice centroid (recomputed on every run to bypass any
 * in-process cache). Output is JSON on stdout.
 *
 * The output INCLUDES PII (userMessage, responseText) so we can do
 * local-only analysis. Save to a gitignored path; do NOT commit it.
 *
 *   pnpm exec tsx scripts/inspect-fallback-turns.ts [N] > /tmp/turns.json
 *
 * The committed report uses turn IDs only and aggregate distributions —
 * never quotes raw user content.
 */

interface CosineResult {
  cosine: number | null;
  reason: string | null;
}

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
  if (ma === 0 || mb === 0) return 0;
  return dot(a, b) / (ma * mb);
}

function averageVectors(vectors: number[][]): number[] {
  const dim = vectors[0]!.length;
  const out = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i += 1) out[i] = (out[i] ?? 0) + (v[i] ?? 0);
  }
  for (let i = 0; i < dim; i += 1) out[i] = (out[i] ?? 0) / vectors.length;
  return out;
}

async function main(): Promise<void> {
  const limit = Number(process.argv[2] ?? '20');
  const config = loadConfig();
  const { db, close } = getDb(config);

  try {
    // 1. All library_versions (so we can spot v2 rows even when inactive).
    const allLibs = await db
      .select({
        libraryName: libraryVersions.libraryName,
        version: libraryVersions.version,
        hash: libraryVersions.hash,
        active: libraryVersions.active,
        publishedAt: libraryVersions.publishedAt,
        publishedBy: libraryVersions.publishedBy,
        notes: libraryVersions.notes,
      })
      .from(libraryVersions)
      .orderBy(desc(libraryVersions.publishedAt));
    const activeLibs = allLibs.filter((r) => r.active);

    // 2. Last N turns.
    const rows = await db
      .select({
        id: turns.id,
        sessionId: turns.sessionId,
        userMessage: turns.userMessage,
        responseText: turns.responseText,
        intent: turns.intent,
        practiceTag: turns.practiceTag,
        levelTag: turns.levelTag,
        responseMode: turns.responseMode,
        modelUsed: turns.modelUsed,
        fallbackPath: turns.fallbackPath,
        qaOutcome: turns.qaOutcome,
        retryCount: turns.retryCount,
        latencyMs: turns.latencyMs,
        degradationFlags: turns.degradationFlags,
        libraryVersions: turns.libraryVersions,
        determinismHash: turns.determinismHash,
        terminalEvent: turns.terminalEvent,
        createdAt: turns.createdAt,
      })
      .from(turns)
      .orderBy(desc(turns.createdAt))
      .limit(limit);

    // 3. Compute the voice centroid fresh from voiceRulesV1 (the same
    //    static import the live check uses). Voyage allows up to 128
    //    inputs per request; we batch the ~10 positiveExamples into one
    //    call to stay well under the 3 RPM free-tier ceiling.
    const positiveExamples: string[] = [];
    for (const rule of voiceRulesV1.rules) {
      for (const example of rule.positiveExamples) positiveExamples.push(example);
    }
    const centroidRes = await voyageEmbed(config, {
      model: 'voyage-3',
      texts: positiveExamples,
      inputType: 'query',
      timeoutMs: 30000,
    });
    const centroid = averageVectors(centroidRes.embeddings);

    // 4. Batch-embed every non-null responseText in one call, then
    //    cosine each against the centroid.
    const candidateIds: string[] = [];
    const candidateTexts: string[] = [];
    for (const r of rows) {
      if (r.responseText !== null && r.responseText.length > 0) {
        candidateIds.push(r.id);
        candidateTexts.push(r.responseText);
      }
    }
    const cosines: Record<string, CosineResult> = {};
    if (candidateTexts.length > 0) {
      try {
        const candRes = await voyageEmbed(config, {
          model: 'voyage-3',
          texts: candidateTexts,
          inputType: 'query',
          timeoutMs: 60000,
        });
        for (let i = 0; i < candidateIds.length; i += 1) {
          const v = candRes.embeddings[i];
          const id = candidateIds[i]!;
          cosines[id] = v
            ? { cosine: cosineSimilarity(v, centroid), reason: null }
            : { cosine: null, reason: 'voyage returned no embedding' };
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'embed error';
        for (const id of candidateIds) cosines[id] = { cosine: null, reason };
      }
    }
    for (const r of rows) {
      if (cosines[r.id] === undefined) {
        cosines[r.id] = { cosine: null, reason: 'no responseText' };
      }
    }

    // 5. Also count overall qaOutcome distribution beyond the last N
    //    so we can show whether E3/E6 spike is concentrated or chronic.
    const distRows = await db
      .select({
        qaOutcome: turns.qaOutcome,
        retryCount: turns.retryCount,
        fallbackPath: turns.fallbackPath,
        modelUsed: turns.modelUsed,
      })
      .from(turns)
      .orderBy(desc(turns.createdAt))
      .limit(200);

    const dist: Record<string, number> = {};
    for (const r of distRows) {
      const k = r.qaOutcome ?? 'null';
      dist[k] = (dist[k] ?? 0) + 1;
    }

    const out = {
      generatedAt: new Date().toISOString(),
      schema: 'phase-12-fallback-diagnostic.v1',
      threshold: 0.65,
      voiceRulesSeedSamples: positiveExamples.length,
      activeLibraryVersions: activeLibs,
      allLibraryVersions: allLibs,
      qaOutcomeDistributionLast200: dist,
      turns: rows.map((r) => ({
        ...r,
        cosine: cosines[r.id]?.cosine ?? null,
        cosineError: cosines[r.id]?.reason ?? null,
      })),
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
