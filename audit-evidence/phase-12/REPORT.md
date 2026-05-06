# Phase 12 — Voice Fidelity Acceptance Suite

**Recorded:** 2026-05-07
**Branch:** `tests/phase-12-voice-fidelity`
**Suite status:** `pnpm test` 656 passed / 3 todo / 0 failed · `pnpm typecheck` 0 · `pnpm lint` 0

This report summarizes the 50-scenario voice-fidelity test suite (T1–T50) drawn from `hogaan-test-scenarios.pptx` slides 4–56. Each scenario is one of:

- **PASS** — test exists and is green in CI; per-scenario evidence JSON is in this directory
- **DEFERRED** — semantic / live-LLM judgment that must be assessed via the voice-smoke harness (Bucket 3)
- **CROSS-REF** — already covered by an existing test under `tests/quality-check/` or `tests/onboarding/`; phase-12 evidence is by reference, not duplication

## Summary

| Status | Count |
|---|---|
| PASS | 41 |
| SIGNOFF-PENDING | 0 |
| DEFERRED to voice-smoke | 5 |
| CROSS-REF (covered elsewhere) | 4 |

The 14 originally-blocked scenarios closed in the followup work (commits `6a542ad` … `0924050`): T2, T4, T6, T7, T8, T9, T11, T14, T15, T16, T17, T18, T19, T20.

## Per-scenario detail

| T-ID | Status | Test file | Evidence JSON | Reason / link |
|---|---|---|---|---|
| T1 | PASS | tests/phase-12/category-a-tagging.test.ts | t1-fire-someone | "had to fire" → accountability ∈ {integrity, accountability} |
| T2 | PASS | tests/phase-12/category-a-tagging.test.ts | t2-feel-pointless | keywords `pointless` / `why am i even` → purpose |
| T3 | PASS | tests/phase-12/category-a-tagging.test.ts | t3-own-this | "own this" → accountability |
| T4 | PASS | tests/phase-12/category-a-tagging.test.ts | t4-lost-face | keywords `lost face` / `losing face` → dignity (practice axis only — §3 keyword approval covers practice; level falls back to self) |
| T5 | PASS | tests/phase-12/category-a-tagging.test.ts | t5-going-through | "going through" → empathy |
| T6 | PASS | tests/phase-12/category-a-tagging.test.ts | t6-never-speaks-up | keywords `never speaks up` / `never speak up` → inclusion |
| T7 | PASS | tests/phase-12/category-a-tagging.test.ts | t7-cost-cutting-assets | keywords `what we don't have` / `morale is low` / `scarcity` → assets; existing `the org` → organization |
| T8 | PASS | tests/phase-12/category-a-tagging.test.ts | t8-different-way | keyword `different way of working` → innovation |
| T9 | PASS | tests/phase-12/category-a-tagging.test.ts | t9-closed-deal-compounds | keywords `compound` / `compounds` / `compounding` → prosperity |
| T10 | PASS | tests/phase-12/category-a-tagging.test.ts | t10-pushback | "pushback" → humility |
| T11 | PASS | tests/phase-12/category-a-tagging.test.ts | t11-voices-dominate | keywords `voices dominate` / `dominate every decision` / `never weigh in` → democracy |
| T12 | PASS | tests/phase-12/category-a-tagging.test.ts | t12-public-feud | "feud" → peace |
| T13 | PASS | tests/phase-12/category-a-tagging.test.ts | t13-sleepless | "i'm sleepless" → self |
| T14 | PASS | tests/phase-12/category-a-tagging.test.ts | t14-leader-blames-self, t14-self-override-precedence | new `SELF_OVERRIDE_PHRASES` precedence rule in `tagPracticeAndLevel` — leader-responsibility phrases force level=self over team hits |
| T15 | PASS | tests/phase-12/category-a-tagging.test.ts | t15-monday-standup | keywords `standup` / `stand-up` / `team meeting` / `one-on-ones` → team |
| T16 | PASS | tests/phase-12/category-a-tagging.test.ts | t16-number-two | keywords `number two` / `my deputy` / `my second` / `my right hand` → team |
| T17 | PASS (regression-lock) | tests/phase-12/category-a-tagging.test.ts | t17-company-values | passed against existing code without source change — `company` → organization, `integrity` fallback satisfies pptx "integrity or accountability" |
| T18 | PASS | tests/phase-12/category-a-tagging.test.ts | t18-org-functions-peace | keywords `hate each other` / `don't get along` / `always fighting` → peace; `engineering and product` / `product and engineering` / `and sales` / `and marketing` / `cross-functional` → organization |
| T19 | PASS | tests/phase-12/category-a-tagging.test.ts | t19-diaspora-council | keywords `i'm not sure` / `not sure i should` → humility; `diaspora` / `diaspora council` / `community council` / `civic council` → community |
| T20 | PASS | tests/phase-12/category-a-tagging.test.ts | t20-foundation | existing `i don't know` keeps humility; new keywords `foundation` / `nonprofit` / `philanthropy` → community |
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
| T36 | CROSS-REF + DEFERRED (semantic) | tests/phase-12/category-b-framing-qc.test.ts (it.todo) | — | "obviously…" oversimplification — gated on BPMN decision: new Check 17 vs Check 7 prompt extension |
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

All originally-blocked tagger keyword work is now closed. Remaining gates:

| Blocker | Decider | Gated tests |
|---|---|---|
| T26 enforcement — library-content invariant only or assembler defensive trim? | Hamse + engineering | T26 (runtime side) |
| T36 oversimplification — new Check 17 vs Check 7 prompt extension | BPMN owner + Hamse | T36 |
| T38 indirect-crisis — extend `_CRISIS_KEYWORDS` deterministically or rely on Llama Tier-B? | Safety lead | T38 (deterministic side) |
| Voice-smoke harness | Engineering + Hamse | T32, T34, T35, T36 (semantic), T26 (response side), T38 (live Llama) |

## Over-fire regression guards

[tests/phase-12/category-a-over-fire-guards.test.ts](../../tests/phase-12/category-a-over-fire-guards.test.ts) documents the bound on user-approved keywords that risked false-positive matches outside leadership context (per followup plan §4):

- `'compound interest'` alone → `prosperity` practice + `level=self` (acknowledged by design)
- `'laying a foundation for our team'` → level ∈ {team, community} (acceptable competition)
- `'and marketing this idea'` → `level=organization` (acknowledged by design — coaching context)
- `'this conversation feels pointless'` → `purpose` practice (acceptable per §4)

## Commits in this branch

1. `abe76ad` test(phase-12): Category C safety+control regression suite (T37–T45 except T44)
2. `29fb22f` fix(coaching): T44 trailing-conjunction guard in continuation parser
3. `0637bb3` test(phase-12): Category A tagging green-subset + blocked it.todo list
4. `5b92ad7` test(phase-12): Category D lifecycle tests (T46–T50)
5. `7ff06c8` test(phase-12): Category B framing + QC tests (T21–T35 except T28, T30, T31, T36)
6. `b4ecf9d` docs(phase-12): REPORT.md summarizing T1–T50 outcomes
7. `6a542ad` feat(coaching/tagger): T14 self-override precedence rule + tests
8. `2d4331b` test(phase-12): T17 company-values regression lock
9. `a3fa610` feat(coaching/tagger): practice + level keywords for 11 phase-12 scenarios
10. `0924050` feat(coaching/tagger): T18 dual-axis (peace + organization) + delete empty blocked file
11. `3e121f6` test(phase-12): tagger over-fire regression guards
12. (this commit) docs(phase-12): update REPORT.md to 41/0/5/4

## Next steps

The remaining work routes through three independent decisions (none gated on tagger keywords any more):

1. T26 — pick the enforcement-layer model (library-content invariant vs assembler defensive trim).
2. T36 — pick the QC-check model (new Check 17 vs Check 7 prompt extension); BPMN signoff if Check 17.
3. T38 — pick the Tier-B handling model (deterministic `_CRISIS_KEYWORDS` extension vs voice-smoke verification).
4. Run the voice-smoke harness for T32, T34, T35, T36 (semantic), T26 (response side), T38 (live Llama) once the runbook is authored.
