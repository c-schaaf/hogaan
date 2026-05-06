# Phase 12 — Application logic mitigations: audit evidence summary

This document indexes every commit in the Phase 12 batch by audit-risk
number, plus the cultural-framing v2 promotion and final cleanup.

Branch: `phase-12-application-logic`. 22 commits, one per risk + library
promotion + cleanup. No squash. Each commit ran `pnpm test` and
`pnpm typecheck` green before landing.

---

## Risk → commit map (in landing order)

| #         | Commit  | Risk addressed                                                                                                                                          |
| --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1**    | 17075be | Wire Phase 11 QC checks into runAllChecks; add CheckId coverage test. Phase 11's voice-fidelity work now actually runs at QC time.                       |
| **R2**    | 347e5e2 | Plumb intent through QcInput; wire checkIntentLength as check_14.                                                                                        |
| **R17**   | 62e2065 | STOP keyword fires at webhook-router scope (was only honored for mid-onboarding users). Onboarded users typing STOP now opt out.                         |
| **R18**   | ebbde38 | Remove 'cancel' and 'end' from opt-out keywords (false-positive prone in leadership context). Canonical 4: STOP/UNSUBSCRIBE/LEAVE/OPT OUT.                |
| **R19**   | 5d05b33 | Single-word scenario abandon keywords (exit/abort/quit) with word-boundary matching. Global STOP at webhook-router takes precedence.                     |
| **R11**   | ace2870 | Replace common-word tagger keywords ('why', 'voice', 'face', 'change', 'monday morning') with phrasal anchors. 20-phrase precision corpus.              |
| **R13**   | f9c3a9e | Tagger situational triggers ('had to fire', 'going through', 'at each other', etc.). §7.3 sample prompts now tag ≥70% match.                            |
| **R6**    | 3685284 | Cultural framing affinity is data-driven from library (practicesMapped field). Legacy PRACTICE_TO_FRAMING table kept as backwards-compat fallback.       |
| **R7-9**  | e72844a | Affinity cascade: 12 practices remapped per audit table. Xil added to v1 (was v2-DRAFT). Hooyo description rewritten for democracy.                      |
| **R12**   | 99127dc | Somali-language keywords added to all 12 PRACTICE_KEYWORDS + 4 LEVEL_KEYWORDS. 25 mixed-Somali test phrases.                                            |
| **R4**    | b1fe780 | Tightened usefulToSocietyPatterns to phrasal anchors only; added LLM intentionality check (check_15).                                                    |
| **R5**    | 4d6db23 | check_06_useful_to_society now required on ALL 4 levels (was only Self/Community). Voice Rule 1 whenToApply rewritten.                                  |
| **R16**   | f889508 | CONSENT_PROMPT rewritten as flowing prose. Tests assert every onboarding message passes Voice Rule 11 (with documented structural-bold exceptions).       |
| **R20**   | 89df156 | persistShortCircuitTurn writes lightweight turn rows for templated paths (greeting/affirmation/meta/profile-ack). Sponsor portal aggregations now see all activity. |
| **R21**   | 9fb43c2 | Memory write for short-circuit turns (in same persistShortCircuitTurn helper). Bot remembers "user said hi yesterday."                                    |
| **R22**   | 59e8eb2 | Continuation close tokens expanded with natural acknowledgment endings ('that helps', 'noted', etc.).                                                    |
| **R14**   | d5e3d7b | 12-practice picker replaces 4-goal taxonomy. parsePractices supports name/multi/level/ALL/fuzzy. formatPracticeAcknowledgment with locked glosses.        |
| **R15**   | 32233ca | CommunityLeader and Advocate roles added. ROLE_PROMPT rewritten as flowing prose.                                                                       |
| **R3**    | cd0e01b | Voice Rule 10 rewritten to remove "bold key phrase" overlap with Rule 11. Rule 11 promoted from v2 DRAFT to v1 active with ratified examples.            |
| **R24**   | 83dedaa | Determinism hash includes R17 secondary tagger fields (secondary_practice_tag, secondary_level_tag, tagger_confidence). Hash version bumped to v2.       |
| **R10**   | d679da1 | Voice-consistency centroid cache invalidates with library cache. lazy-import coupling avoids circular dep.                                              |
| **(I)**   | e76385b | Cultural framing v2 promoted to active (cleanup): cultural-framing-v2.ts removed since its content was inlined in R7-9.                                  |

**R23 (skipped — duplicate of R4.)** Documented in commit history; no separate commit.

---

## Test count and gates

| Metric                       | Before (Phase 11 baseline) | After Phase 12 |
| ---------------------------- | --------------------------- | -------------- |
| Total tests                  | 489                         | 600            |
| New phase-12 tests           | n/a                         | +111           |
| `pnpm typecheck`             | clean                       | clean          |
| `pnpm test`                  | clean                       | clean          |

---

## Latency note

Risk 1 wires 4 new LLM-backed QC checks into the parallel batch
(check_10 lived-experience, check_12 tangible-action, check_15 useful-
to-society anchor, plus check_13 voice-consistency which uses Voyage
embedding instead of Groq). Risk 4 adds a 5th LLM check.

The QC orchestrator runs all LLM checks in `Promise.all`, so wall-clock
is bounded by the slowest. Each check has a 4-second budget. Voyage
centroid is memoized after first call (~300ms warm), so check_13 is a
single embed-query on subsequent calls.

Worst case: 8 LLM checks × 4s budget in parallel = ~4s wall. p99 is
typically ~1s. Still within the QC's 6s p99 turn-budget envelope.

**Live latency profile NOT re-run as part of this batch** — the
profile-latency.ts harness makes real LLM calls (~$0.50/run). That's a
separate ops decision; ops should re-run after merge.

---

## Library promotion notes

Two libraries were promoted to v2 active in this batch:

1. **voice_rules v2 → active** (R3 commit cd0e01b)
   - Added Rule 11 (formatting discipline) with ratified positive/negative examples
   - Rewrote Rule 10 to drop bold-encouragement, cross-reference Rule 11
   - cultural-framing-v2.ts removed (was DRAFT scaffolding)

2. **cultural_framing v2 → active** (R7-9 commit e72844a + Group I e76385b)
   - Added Framing 16: Xil (with ratified gloss + example phrasings + applicableWhen)
   - Updated Hooyo description for democracy practice
   - Populated practicesMapped on every framing per the audit cascade
   - voice-rules-v2.ts removed (was DRAFT scaffolding)

The R10 cache-invalidation coupling ensures the QC voice-consistency
check picks up the new positiveExamples on the next call after publish,
without requiring a process restart.

---

## Audit findings adjusted

- **Closed**: R1, R2, R3, R4, R5, R6, R7+R8+R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22, R24.
- **Skipped**: R23 (duplicate of R4).
- **Library promotion**: voice_rules v2 + cultural_framing v2 both promoted to active. No more DRAFT files in the codebase.

---

## Post-merge production diagnostic (2026-05-06)

A read-only diagnostic against the production `turns` table and
`library_versions` table found that the v2 promotions documented in
"Library promotion notes" above **had not landed in the DB** at the
time of the diagnostic. Active rows for both `voice_rules` and
`cultural_framing` were the pre-Phase-12 hashes published 2026-05-04;
the Phase-12-ratified content lived only in the seed files. This drove
a content split between prompt assembly (DB content) and the
voice-consistency centroid (seed content), and is the likely root
cause of the elevated regen / fallback rate observed post-merge.

Full report: [2026-05-06-phase-12-fallback-diagnostic.md](2026-05-06-phase-12-fallback-diagnostic.md).

### Promotion executed (2026-05-06 17:07 UTC)

After the diagnostic, `voice_rules v2` and `cultural_framing v2` were
promoted to `active=true` in the production `library_versions` table
via [scripts/publish-voice-rules-v2.ts](../../scripts/publish-voice-rules-v2.ts)
and [scripts/publish-cultural-framing-v2.ts](../../scripts/publish-cultural-framing-v2.ts)
(modeled on the existing `publish-crisis-resources-v2.ts`). Both
scripts are idempotent and run the demote-v1 + insert-v2 transaction
inside `publishLibraryVersion`.

Recorded transitions:

| Library          | Before (v1) hash | After (v2) hash | Published by                         |
| ---------------- | ---------------- | ---------------- | ------------------------------------ |
| voice_rules      | `8bcd22a03b9c…`  | `f1077420458e…`  | muhsin:phase-12-promotion-2026-05-06 |
| cultural_framing | `d9695618742c…`  | `93f35de917fb…`  | muhsin:phase-12-promotion-2026-05-06 |

Verified post-promotion: `verifyIntegrity()` confirmed each stored hash
matches a fresh canonical recomputation of the active payload. Old v1
rows remain in DB with `active=false` for audit traceability and easy
rollback.

### Render restart still required

Process-local in-memory caches in the running web server are not
cleared by the DB write:

- `getActiveLibraryVersions()` resolver cache holds v1 payloads in
  the prod process until a restart or in-process `invalidateLibraryCache()`.
- The R10 fix wires `invalidateVoiceCentroidCache()` to library-cache
  flush, but voice-consistency imports `voiceRulesV1` statically from
  the seed file ([src/quality-check/voice-consistency.ts:1](../../src/quality-check/voice-consistency.ts#L1));
  the static binding is fixed at module load, so a process restart is
  the cleanest way to bring both caches into agreement with the new DB
  state.

**Action item:** restart the Render web service for the Hogaan API.
After restart, the resolver re-reads v2 active rows from DB, and
voice-consistency rebuilds its centroid against the (already-current)
seed `positiveExamples`. Both will then describe the same content.

Until restart: prompt assembly continues to use cached v1 content while
QC checks score against v2 — the same mismatch the diagnostic
documented. Promotion alone is necessary but not sufficient.

### Threshold tuning deferred

The voice-consistency 0.65 threshold and any QC wiring changes are
deferred to a separate batch. Re-evaluate after content parity is
verified post-restart and a fresh sample of ≥30 real production turns
has accumulated.

---

## Decisions still requiring Muhsin

1. **Ops**: schedule a `pnpm exec tsx scripts/profile-latency.ts --concurrency 20`
   run on the merged branch to confirm post-Phase-12 p99 holds within the
   6s budget. R1 + R4 added 5 LLM checks to the parallel QC batch — the
   model says wall-clock is unchanged because they fan out concurrently,
   but the live measurement is the audit signal.

2. **Ops**: when the next library publish runs (e.g. v3 voice_rules),
   confirm the lazy-import path in invalidateLibraryCache fires
   correctly — the test pins behavior with mocks but a live Render
   restart-free publish is the production smoke.

---

## Re-running

```bash
# All deterministic Phase 12 tests
pnpm test tests/coaching tests/onboarding tests/quality-check tests/libraries tests/prompt-assembly

# Type + lint gates
pnpm typecheck
pnpm lint
```
