# Phase 12 — Voice Fidelity Acceptance Suite

**Recorded:** 2026-05-06
**Branch:** `tests/phase-12-voice-fidelity`
**Suite status:** `pnpm test` 637 passed / 17 todo / 0 failed · `pnpm typecheck` 0 · `pnpm lint` 0

This report summarizes the 50-scenario voice-fidelity test suite (T1–T50) drawn from `hogaan-test-scenarios.pptx` slides 4–56. Each scenario is one of:

- **PASS** — test exists and is green in CI; per-scenario evidence JSON is in this directory
- **DEFERRED** — semantic / live-LLM judgment that must be assessed via the voice-smoke harness (Bucket 3)
- **SIGNOFF-PENDING** — engineering work is gated on a Hamse content review or a BPMN end-event decision; tracked as `it.todo` so the test report shows it as pending, not silently omitted
- **CROSS-REF** — already covered by an existing test under `tests/quality-check/` or `tests/onboarding/`; phase-12 evidence is by reference, not duplication

## Summary

| Status | Count | Tests |
|---|---|---|
| PASS | 27 | T1, T3, T5, T10, T12, T13, T21–T25, T26 (×2), T27 (×2), T29 (×2), T32, T33, T34, T35, T37, T39, T40, T41 (×2), T42, T43, T44 (×2), T45, T46, T47, T48, T49, T50 |
| SIGNOFF-PENDING | 14 | T2, T4, T6, T7, T8, T9, T11, T14, T15, T16, T17, T18, T19, T20 |
| DEFERRED to voice-smoke | 5 | T32 (semantic), T34 (semantic), T35 (semantic), T36, T38 |
| CROSS-REF (covered elsewhere) | 4 | T28 (covered by existing short-circuit-intents test), T30, T31, plus T36 also has a CROSS-REF disposition pending the Check decision |

## Per-scenario detail

| T-ID | Status | Test file | Evidence JSON | Reason / link |
|---|---|---|---|---|
| T1 | PASS | tests/phase-12/category-a-tagging.test.ts | t1-fire-someone | "had to fire" → accountability ∈ {integrity, accountability} |
| T2 | SIGNOFF-PENDING | tests/phase-12/category-a-tagging-blocked.test.ts | — | "why am I **even** doing" doesn't match keyword `why am i doing` |
| T3 | PASS | tests/phase-12/category-a-tagging.test.ts | t3-own-this | "own this" → accountability |
| T4 | SIGNOFF-PENDING | tests/phase-12/category-a-tagging-blocked.test.ts | — | "**lost** face" doesn't match keyword `lose face` |
| T5 | PASS | tests/phase-12/category-a-tagging.test.ts | t5-going-through | "going through" → empathy |
| T6 | SIGNOFF-PENDING | tests/phase-12/category-a-tagging-blocked.test.ts | — | "**never speaks** up" doesn't match `doesn't speak up` |
| T7 | SIGNOFF-PENDING | tests/phase-12/category-a-tagging-blocked.test.ts | — | "cost-cutting" / "morale" not in assets keywords |
| T8 | SIGNOFF-PENDING | tests/phase-12/category-a-tagging-blocked.test.ts | — | "**different** way of working" doesn't match `new way of working` |
| T9 | SIGNOFF-PENDING | tests/phase-12/category-a-tagging-blocked.test.ts | — | "closed a deal" / "compounds" not in prosperity keywords |
| T10 | PASS | tests/phase-12/category-a-tagging.test.ts | t10-pushback | "pushback" → humility |
| T11 | SIGNOFF-PENDING | tests/phase-12/category-a-tagging-blocked.test.ts | — | "same three voices dominate" not in democracy keywords |
| T12 | PASS | tests/phase-12/category-a-tagging.test.ts | t12-public-feud | "feud" → peace |
| T13 | PASS | tests/phase-12/category-a-tagging.test.ts | t13-sleepless | "i'm sleepless" → self |
| T14 | SIGNOFF-PENDING | tests/phase-12/category-a-tagging-blocked.test.ts | — | "my team is failing because of me" — Hamse spec call: self-level (leader self-blame) or team-level? |
| T15 | SIGNOFF-PENDING | tests/phase-12/category-a-tagging-blocked.test.ts | — | "Monday standup" not in team keywords |
| T16 | SIGNOFF-PENDING | tests/phase-12/category-a-tagging-blocked.test.ts | — | "number two" not explicit; verify substring match |
| T17 | SIGNOFF-PENDING | tests/phase-12/category-a-tagging-blocked.test.ts | — | "company values" — verify "company" alone routes to organization |
| T18 | SIGNOFF-PENDING | tests/phase-12/category-a-tagging-blocked.test.ts | — | "Engineering and Product" — no level keyword present, falls back to self |
| T19 | SIGNOFF-PENDING | tests/phase-12/category-a-tagging-blocked.test.ts | — | "diaspora council" not in community keywords (culturally important for Somali users) |
| T20 | SIGNOFF-PENDING | tests/phase-12/category-a-tagging-blocked.test.ts | — | "foundation" not explicit; relies on adjacent words |
| T21 | PASS | tests/phase-12/category-b-framing-qc.test.ts | t21-xil-accountability | accountability → Xil |
| T22 | PASS | tests/phase-12/category-b-framing-qc.test.ts | t22-naxariis-empathy | empathy → Naxariis |
| T23 | PASS | tests/phase-12/category-b-framing-qc.test.ts | t23-geed-daad-humility | humility → Geed daad |
| T24 | PASS | tests/phase-12/category-b-framing-qc.test.ts | t24-hooyo-democracy | democracy → Hooyo |
| T25 | PASS | tests/phase-12/category-b-framing-qc.test.ts | t25-maslaxad-peace | peace → Maslaxad |
| T26 | PASS | tests/phase-12/category-b-framing-qc.test.ts | t26-rule7-single-concept, t26-excluded-modes-no-framing | Voice Rule 7 selection-time invariant; runtime LLM-output validation → voice-smoke |
| T27 | PASS | tests/phase-12/category-b-framing-qc.test.ts | t27-formatting-headers, t27-formatting-pass | Check 11 catches `## headers`; clean prose passes |
| T28 | CROSS-REF | tests/coaching/short-circuit-intents.test.ts | — | Greeting short-circuit covered in existing Phase-11 short-circuit-intents tests |
| T29 | PASS | tests/phase-12/category-b-framing-qc.test.ts | t29-coaching-length-band, t29-shortcircuit-bands | Per-intent bands match plan §2 spec |
| T30 | CROSS-REF | tests/quality-check/tangible-action.test.ts | — | Check 12 already exercised; phase-12 evidence by reference |
| T31 | CROSS-REF | tests/quality-check/lived-experience.test.ts | — | Check 10 already exercised; phase-12 evidence by reference |
| T32 | PASS (struct) + DEFERRED (semantic) | tests/phase-12/category-b-framing-qc.test.ts | t32-rule1-anchor-block | Voice-rules block carries Rule 1; semantic anchor in actual LLM response → voice-smoke |
| T33 | PASS | tests/phase-12/category-b-framing-qc.test.ts | t33-hero-to-guide-i-would | Check 5 catches "I would tell" / "I would do" |
| T34 | PASS (struct) + DEFERRED (semantic) | tests/phase-12/category-b-framing-qc.test.ts | t34-rule2-asset-based-block | Voice-rules block carries Rule 2; semantic reframe in LLM output → voice-smoke |
| T35 | PASS (struct) + DEFERRED (semantic) | tests/phase-12/category-b-framing-qc.test.ts | t35-rule8-fluff | Check 5 catches "you've got this" / "believe in yourself"; semantic warmth → voice-smoke |
| T36 | SIGNOFF-PENDING + DEFERRED (semantic) | tests/phase-12/category-b-framing-qc.test.ts (it.todo) | — | "obviously…" oversimplification — gated on BPMN decision: new Check 17 vs Check 7 prompt extension |
| T37 | PASS | tests/phase-12/category-c-safety-control.test.ts | t37-crisis-direct | "I want to kill myself" → fastPathTriage status='crisis' synchronously |
| T38 | DEFERRED | tests/phase-12/category-c-safety-control.test.ts | t38-crisis-indirect | Tier-B indirect crisis. Live Llama classifier verification → voice-smoke. Optional `_CRISIS_KEYWORDS` extension awaits safety-lead signoff |
| T39 | PASS | tests/phase-12/category-c-safety-control.test.ts | t39-crisis-false-positive | "end this conflict" doesn't trigger crisis fast-path |
| T40 | PASS | tests/phase-12/category-c-safety-control.test.ts | t40-optout-stop | STOP → isOptOutMessage true |
| T41 | PASS | tests/phase-12/category-c-safety-control.test.ts | t41-optout-cancel-meeting, t41-optout-end-cycle | "cancel meeting" / "end this cycle" → false (R18 removed) |
| T42 | PASS | tests/phase-12/category-c-safety-control.test.ts | t42-scenario-exit | "exit" → isAbandonRequest true |
| T43 | PASS | tests/phase-12/category-c-safety-control.test.ts | t43-natural-close-that-helps | "That helps." → close (R22) |
| T44 | PASS | tests/phase-12/category-c-continuation-t44.test.ts | t44-mid-convo-thanks-continue, t44-close-still-fires | RED→GREEN: trailing-conjunction guard added to `decideContinuation`; bare close-tokens still close |
| T45 | PASS | tests/phase-12/category-c-safety-control.test.ts | t45-goodbye | "Goodbye" → close |
| T46 | PASS | tests/phase-12/category-d-lifecycle.test.ts | t46-greeting-template | GREETING_RESPONSE word count 10–80 |
| T47 | PASS | tests/phase-12/category-d-lifecycle.test.ts | t47-affirmation-template | AFFIRMATION_RESPONSE word count 5–50 |
| T48 | PASS | tests/phase-12/category-d-lifecycle.test.ts | t48-meta-template | META_TEMPLATE word count 30–100, contains BRAND_FRAMEWORK_ATTRIBUTION token, no markdown |
| T49 | PASS | tests/phase-12/category-d-lifecycle.test.ts | t49-practice-picker | "humility, peace" / "ALL" / "self" all parse |
| T50 | PASS | tests/phase-12/category-d-lifecycle.test.ts | t50-role-taxonomy | "advocate" → Advocate; "community organizer" → CommunityLeader |

## What's blocked and on whom

| Blocker | Decider | Gated tests |
|---|---|---|
| Tagger keyword additions for natural-language phrasings of already-approved Voice/Cultural concepts | Hamse | T2, T4, T6, T7, T8, T9, T11, T15, T16, T19, T20 |
| T14 spec clarification (self vs team for "my team is failing because of me") | Hamse + product | T14 |
| T17, T18 verification — does current `company` / `function` keyword routing match user intent? | Hamse | T17, T18 |
| T26 enforcement — library-content invariant only or assembler defensive trim? | Hamse + engineering | T26 (runtime side) |
| T36 oversimplification — new Check 17 vs Check 7 prompt extension | BPMN owner + Hamse | T36 |
| T38 indirect-crisis — extend `_CRISIS_KEYWORDS` deterministically or rely on Llama Tier-B? | Safety lead | T38 (deterministic side) |
| Voice-smoke harness | Engineering + Hamse | T32, T34, T35, T36 (semantic), T26 (response side), T38 (live Llama) |

## Commits in this branch

1. `abe76ad` test(phase-12): Category C safety+control regression suite (T37-T45 except T44)
2. `29fb22f` fix(coaching): T44 trailing-conjunction guard in continuation parser
3. `0637bb3` test(phase-12): Category A tagging green-subset + blocked it.todo list
4. `5b92ad7` test(phase-12): Category D lifecycle tests (T46-T50)
5. `7ff06c8` test(phase-12): Category B framing + QC tests (T21-T35 except T28, T30, T31, T36)

## Next steps (after this work)

When the SIGNOFF-PENDING items are resolved:

1. Promote each `it.todo` in `tests/phase-12/category-a-tagging-blocked.test.ts` to a regular `it()` with the assertion documented in the plan §3 Phase R.
2. Add the corresponding tagger keyword updates per plan §3 Phase G; commit each batch separately so the suite stays green at every boundary.
3. Re-run the suite, regenerate evidence JSONs, and re-emit this REPORT.md.
4. Run the voice-smoke harness for the DEFERRED items per `audit-evidence/phase-12/VOICE_SMOKE_PLAN.md` (to be authored as Plan F3).
