# Audit F-10 — Library Cache Restart Verification

**Date:** 2026-05-08
**Audit ID:** F-10 (Hogaan_Timeout_Audit)
**Status:** **NO RESTART REQUIRED** — already mitigated by both (a) Render
deploy redeploys observed after the publish moment, and (b) the resolver's
60-second cache TTL.

## Audit memo claim

`audit-evidence/phase-12/SUMMARY.md` and the 2026-05-06 fallback diagnostic
postscript stated: "v2 voice_rules and cultural_framing libraries published
2026-05-06 17:07 UTC require an in-process cache flush via Render web
service restart." The implication was that prompt-assembly might still be
serving cached v1 content while QC scoring runs against v2 — a per-turn
mismatch.

## Verification (read-only, code path)

### 1. The resolver's in-process cache is NOT restart-only

[src/libraries/resolver.ts:40-47](../../src/libraries/resolver.ts#L40-L47):

```ts
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  resolved: ResolvedLibraries;
  expiresAt: number;
}

let cache: CacheEntry | undefined;
```

Used at [resolver.ts:51-53](../../src/libraries/resolver.ts#L51-L53):

```ts
if (cache !== undefined && cache.expiresAt > now) {
  return cache.resolved;
}
```

Refreshed at [resolver.ts:99](../../src/libraries/resolver.ts#L99):

```ts
cache = { resolved, expiresAt: now + CACHE_TTL_MS };
```

**Refresh conditions:**
- **TTL expiry** (every 60 seconds) — automatic, no signal needed.
- Manual `invalidateLibraryCache()` at [resolver.ts:163](../../src/libraries/resolver.ts#L163) — clears `cache` and lazy-imports `voice-consistency.js` to clear the centroid cache too.
- `resetResolverForTests()` at [resolver.ts:178](../../src/libraries/resolver.ts#L178) — test seam only.
- Process restart (cache is module-level state).

**Conclusion on cache architecture:** the audit memo's "Render restart still required" framing is inaccurate. Even if no restart had happened, the 60s TTL would have flushed the cache automatically within one minute of the 2026-05-06 17:07 UTC publish. There was at most a 60-second window of stale-cache reads, and that window closed on 2026-05-06 17:08 UTC at the latest.

### 2. Render deploy log evidence

We observed two Render dyno boots in earlier smoke traces during this RCA work, both on 2026-05-08:

| Source | Boot timestamp (UTC) | After 2026-05-06 17:07 UTC publish? |
|---|---|---|
| Earlier smoke trace (waMessageId `SM64e518d1c30d37188b68601ede72d5e6`) | 2026-05-08 07:05:12 UTC | **YES** (~38 hours after) |
| F-02 audit smoke trace (waMessageId `SMee8f2aa2b01830a3283a18235c21ce8b`) | 2026-05-08 09:55:42 UTC | **YES** (~41 hours after) |

Both boots are well after the 2026-05-06 17:07 UTC publish moment. Either of them alone fully invalidates the in-process cache that existed at publish time.

### 3. DB-active library version check

The script `scripts/check-active-libraries.ts` queries `library_versions` for `active=true` rows. **It requires a live DB connection (uses `getDb(loadConfig())` and reads from production)** so it cannot be executed from this read-only investigation environment. To complete this leg of the verification, please run:

```bash
pnpm tsx scripts/check-active-libraries.ts
```

against production credentials. The expected output (per the 2026-05-06 17:07 UTC postscript) is:

- `voice_rules` v2, hash matching the seed file
- `cultural_framing` v2, hash matching the seed file
- `prompt_templates` v1 (unchanged)
- `crisis_resources` and `scenarios` whatever was already active

If the output instead shows `voice_rules` v1 or `cultural_framing` v1 as active, the publish itself didn't take effect — that's a different bug class than F-10's cache-restart concern, and would need an investigation of the publish script itself.

## Result

**RESTART REQUIRED: NO**

The F-10 concern is double-mitigated:
1. The resolver cache is TTL-based (60s), not restart-only. The cache auto-refreshed within 60 seconds of the 2026-05-06 17:07 UTC publish, regardless of any subsequent action.
2. Even if you wanted belt-and-suspenders restart confirmation: the dyno has booted at least twice in the last ~60 hours (07:05 and 09:55 UTC on 2026-05-08), each well after the publish.

The audit memo's wording ("Render restart still required") should be retired. Recommend updating `audit-evidence/phase-12/SUMMARY.md` to reflect that F-10 is closed. The remaining open question is whether the DB rows themselves match the v2 seed — that requires running `check-active-libraries.ts` against production but is independent of any cache or restart concern.

## Caveat

This verification observes process-level boots from log timestamps. It does NOT verify:
- That the publish script actually inserted the v2 rows (`check-active-libraries.ts` covers this).
- That the v2 payload hashes in DB match the v2 seed-file payloads (`pnpm tsx scripts/verify-baseline.ts` or `verifyIntegrity()` in resolver.ts handles this).
- That every Render instance behind a load balancer has booted (Hogaan currently runs 1 web instance per WEB_CONCURRENCY=1 in the boot logs, so this is moot for now).

If multi-instance Render scaling is enabled later, this verification would need to expand.
