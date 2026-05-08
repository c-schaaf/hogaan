# Pre-Launch Quality-Check Deactivation + Classifier JSON-Extraction Fix

**Date:** 2026-05-08
**Branch:** `fix/classifier-json-extraction-and-quality-check-removal`
**Author:** Claude Code (Opus 4.7)
**Driver:** trusted-user pilot smoke trace surfaced two distinct QC failure modes; this record documents the deactivations and the upstream parser fix shipped to resolve the persistent FALLBACK_DEGRADED loop.

## Summary

Three changes shipped together:

1. **Classifier JSON-extraction fix** ([src/shared/llm/classifier.ts](src/shared/llm/classifier.ts)) — `classifierChat` now extracts the first balanced `{...}` JSON object from the LLM response before returning to callers. This resolves the persistent FALLBACK_DEGRADED loop documented in the prior audit (see Cross-references below).
2. **Check 10 (lived_experience) deactivated** from runtime wiring ([src/quality-check/orchestrator.ts](src/quality-check/orchestrator.ts)) — the LLM grader was producing soft_fail at a rate that forced unnecessary regen on the trusted-user pilot. Implementation preserved.
3. **Check 11 (formatting_discipline) deactivated** from runtime wiring ([src/quality-check/orchestrator.ts](src/quality-check/orchestrator.ts)) — the regex was tripping on benign WhatsApp-native shapes. Implementation preserved.

Pattern matches the 2026-05-08 Check 13 / Check 16 removal (commit `43a7301`): wiring removed, implementations preserved, CheckId enum entries kept, isolated unit tests retained, orchestration-level coverage assertion updated with explicit removal markers.

## Part A — Classifier JSON-extraction fix (root cause of the FALLBACK_DEGRADED loop)

### Symptom

Every inbound user turn on Render production deployment `hogaan.onrender.com` rendered the [`FALLBACK_DEGRADED`](src/quality-check/fallbacks.ts#L19) template:

> "Something on my end isn't responding the way it should. I don't want to give you a worse answer than the question deserves — try me again in a few minutes."

Reproducible on trivially different inputs ("hi", "I had to fire someone today. They had a kid on the way…") across multiple sessions, multiple hours.

### 5-whys

1. User receives FALLBACK_DEGRADED on every turn → orchestrator dispatches `FALLBACK_DEGRADED` ([src/coaching/orchestrator.ts](src/coaching/orchestrator.ts)).
2. Why? QC ends with `E6_ServiceUnavailable` ([src/quality-check/orchestrator.ts:129-138](src/quality-check/orchestrator.ts#L129-L138)).
3. Why E6? `check_08_safety_crisis` returns `service_unavailable` — fail-closed by design (CLAUDE.md hard rule #1).
4. Why service_unavailable? `JSON.parse(res.text)` at [src/quality-check/checks-llm.ts:173](src/quality-check/checks-llm.ts#L173) throws `Unexpected non-whitespace character after JSON at position 182 (line 6 column 1)`.
5. Why does the parse throw? [`classifierChat`](src/shared/llm/classifier.ts) uses Anthropic's prefill-`{` pattern (Anthropic has no native JSON mode). At temperature 0 with Check 8's longer two-axis prompt (response-safety axis + user-message-crisis axis simultaneously), Haiku 4.5 deterministically emits a complete `{...}` verdict followed by trailing content (a second `{...}` block, a markdown trailer, or commentary). Strict `JSON.parse` rejects any non-whitespace after the first object closes.

The other 7 LLM checks pass in the same parallel batch because their simpler binary `{"pass": ...}` prompts elicit clean single-object output. Determinism at temperature 0 is exactly what made the bug reproducible across distinct inputs and hours.

### Fix

Added `extractFirstJsonObject` helper in [src/shared/llm/classifier.ts](src/shared/llm/classifier.ts). After the wrapper reconstructs the prefilled JSON (`'{' + res.text`), it slices to the first balanced `{...}` and returns that. Brace-matching skips `{` / `}` characters that appear inside string literals (with `\\` escape support) so a `}` inside a `reason` field cannot close the object early. If no balanced object exists, the raw text is returned unchanged so the caller's strict `JSON.parse` still throws — fail-closed semantics for Check 8 → E6 are preserved.

The fix is at the wrapper layer because `classifierChat` already owns the prefill-`{` JSON contract; it is the right boundary to also own "extract the JSON the model emitted." Every classifier consumer (intent triage, all 8 LLM-judged QC checks before this commit's Check 10 deactivation, practice-grounding judge) benefits with one change.

**No safety-prompt content was modified.** The prompt under `src/coaching/libraries/` is Hamse-owned (CLAUDE.md hard rule #3) and the Check 8 system prompt is safety-critical (hard rule #1). Both are untouched. The verdict-mapping switch in [checks-llm.ts:179-194](src/quality-check/checks-llm.ts#L179-L194) is also untouched; the fix moves only at the parse boundary.

### Verification

Unit tests ([tests/shared/llm/classifier.test.ts](tests/shared/llm/classifier.test.ts)) cover five cases for the new helper:

1. Clean JSON passes through unchanged.
2. Trailing prose after a complete object is stripped (the documented production trailer shape).
3. A trailing second JSON object is stripped (the position-182 failure shape from the production logs).
4. `}` and `\"` inside a string-literal value do not close the object early.
5. Pure prose with no `{` is returned unchanged so the caller's strict `JSON.parse` still throws → fail-closed preserved.

End-to-end production verification: deploy the branch and confirm a Render trace where `check_08_safety_crisis` ends with `status:"pass"` (or any valid verdict) and the turn ends with `qcEndEvent:E1_ApprovedFirstAttempt` (or E2 after a regen). Confirm `dispatching FALLBACK_DEGRADED` no longer appears on coaching turns.

## Part B — Deactivation of Check 10 (lived_experience) and Check 11 (formatting_discipline)

Both checks are pure quality-shaping. Neither has a safety implication; deactivation cannot create a crisis-routing miss (CLAUDE.md hard rule #1 is unaffected).

### Check 10 — lived_experience

- **Implementation:** [`checkLivedExperienceDiscipline`](src/quality-check/checks-llm.ts) — preserved.
- **Function:** Voice Rule 6 enforcement ("lived authority sparingly" — Hamse's lived-experience markers must serve an insight, never stand in as a credential). LLM-judged on Anthropic Haiku 4.5.
- **Deactivation reason:** the trusted-user smoke trace observed soft_fail emissions on responses that, on human read-through, were within Voice Rule 6. The grader's threshold for "credential without insight" needs recalibration against a wider Hamse-validated corpus before the soft_fail signal is trustworthy enough to drive regen.
- **Reactivation criteria:** (a) recalibrated grader prompt + sample-size ≥30 Hamse-validated pass/fail labels with ≤5% false-positive rate on the pass set, AND (b) a fixture test that pins the grader's behavior on the validated corpus.

### Check 11 — formatting_discipline

- **Implementation:** [`checkFormattingDiscipline`](src/quality-check/checks-rule-based.ts) — preserved.
- **Function:** Voice Rule 11 enforcement (regex-based: at most one `*bold*` segment per response, no markdown headers, no `**double-asterisk**` since WhatsApp uses single-asterisk bold).
- **Deactivation reason:** the trusted-user smoke trace observed soft_fail emissions on benign WhatsApp-native shapes (paragraph breaks, bulleted prose), suggesting the regex is over-matching. The audit clean-up is a regex pass, not a contract change.
- **Reactivation criteria:** the regex test set passes cleanly against (a) a curated corpus of approved Hamse-style WhatsApp coaching responses with zero false-positive soft_fails, AND (b) an extended adversarial corpus that holds true-positive recall on `## headers`, `**double-bold**`, and multi-bold patterns. Both corpora must live in `tests/quality-check/formatting-discipline.test.ts` before re-wiring.

### Pattern parity

Same surgical pattern as the 2026-05-08 Check 13 / Check 16 removal (commit `43a7301`):

- Imports + `runAllChecks` wiring entries removed in [src/quality-check/orchestrator.ts](src/quality-check/orchestrator.ts); `instrumentCheck` wrappers fall away with the wiring.
- Implementations preserved: [`checkLivedExperienceDiscipline`](src/quality-check/checks-llm.ts) (Check 10) and [`checkFormattingDiscipline`](src/quality-check/checks-rule-based.ts) (Check 11) are not touched.
- CheckId enum entries `'check_10_lived_experience'` and `'check_11_formatting_discipline'` kept in [src/quality-check/types.ts](src/quality-check/types.ts) since the preserved implementations still construct CheckResults bearing those IDs (and the isolated unit tests assert on them).
- Orchestration-level test [tests/quality-check/coverage.test.ts](tests/quality-check/coverage.test.ts) `ALL_CHECK_IDS` updated with explicit removal markers; the `describe` text relaxed from "all 13" to "all active".
- Isolated unit tests retained: [tests/quality-check/lived-experience.test.ts](tests/quality-check/lived-experience.test.ts), [tests/quality-check/formatting-discipline.test.ts](tests/quality-check/formatting-discipline.test.ts), [tests/onboarding/messages-formatting.test.ts](tests/onboarding/messages-formatting.test.ts), and the `checkFormattingDiscipline` calls in [tests/phase-12/category-b-framing-qc.test.ts](tests/phase-12/category-b-framing-qc.test.ts) all keep working without modification.
- Comment in [tests/quality-check/corrective.test.ts](tests/quality-check/corrective.test.ts) updated: the SOFT_FAILING_CANDIDATE soft-fail driver is now `check_09_length` (the candidate stays well below the 120-word `FullCoachingResponse` floor); the comment previously cited Check 11 but the candidate already failed length too.

### Active-set after this commit

- **Sync (6):** check_01 practice_tag, check_02 level_tag, check_05 hero_to_guide, check_06 useful_to_society, check_09 length, check_14 intent_length.
- **Parallel LLM (7):** check_03 signature_structure, check_04 asset_based, check_07 tone, check_08 safety_crisis, check_12 tangible_action, check_15 useful_to_society_anchor, check_17 practice_grounding.
- **Removed (2026-05-08 audit):** check_13 voice_consistency, check_16 level_fidelity.
- **Deactivated for pilot (this commit):** check_10 lived_experience, check_11 formatting_discipline.

## Cross-references

- **Production smoke trace** — Render deployment `hogaan.onrender.com`, request id `b8fae517-d295-4025-99e7-3428030ff1e1`, waMessageId `SM6f4b77ebfe7fc0f769979fd90e7c7275`, 2026-05-08T11:25:14Z. Trace shows `check_08_safety_crisis done … status:"service_unavailable" … errMessage:"Unexpected non-whitespace character after JSON at position 182 (line 6 column 1)"` followed by `qcEndEvent:E6_ServiceUnavailable, dispatching FALLBACK_DEGRADED`. Same shape reproduced on subsequent turns (8:21 PM, 8:39 PM, 8:40 PM, 8:59 PM, 10:07 AM, 12:56 PM, 12:57 PM, 2:25 PM in user's WhatsApp screenshot).
- **Prior audit** — [audit-evidence/audits/2026-05-07-reliability-intent-routing-audit.md](audit-evidence/audits/2026-05-07-reliability-intent-routing-audit.md) **R-03** flagged the FALLBACK_DEGRADED user-visibility shape and recommended better trace discriminators between "safety-classifier-down" and "regen-failed". This commit closes the underlying root cause for the Check 8 path; R-03's discriminator recommendation remains open as a separate observability ticket.
- **Precedent removal commit** — `43a7301 fix(qc): remove hidden-rule checks (13 voice_consistency, 16 level_fidelity); clean prompt-template/r11 contradiction`. Same surgical pattern; this commit follows it.
- **CheckId catalog** — [src/quality-check/types.ts](src/quality-check/types.ts) preserves the full enum; [tests/quality-check/coverage.test.ts](tests/quality-check/coverage.test.ts) `ALL_CHECK_IDS` carries the removal markers as the authoritative documentation of what is wired vs. preserved-but-unwired.

## Out of scope

- The Anthropic safety classifier system prompt — left untouched. Tightening "Output ONLY JSON" instructions might reduce trailer emissions but would require recall re-validation on the crisis red-team corpus before merge. Tolerant parsing covers the case without prompt risk.
- Switching the Check 8 path to a provider with native JSON mode (Groq, OpenAI). The stack is locked on Anthropic Haiku 4.5 for this call (CLAUDE.md "Stack — locked"). No SDK upgrade required.
- Observability for "tolerant extractor saved a parse" events. Worth doing as a follow-up so we can measure how often the extractor is masking a model regression, but not blocking this fix.
