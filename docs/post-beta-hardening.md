# Post-beta hardening — deferred items tracker

Created 2026-06-02 at the close of the 50-risk hardening initiative
(Batches A + B shipped; Batch C deferred wholesale per PM call).

## What this file is

A single source-of-truth for the **13 deferred items** from the 50-risk
hardening audit. Each item was explicitly deferred (not forgotten). This
file gives you the trigger to revisit, the rough effort, and a one-line
pointer for the implementer.

If you (or a future Claude session) ask *"didn't we say we'd do X?"* —
look here first. If the trigger has fired, pick the item up; if it
hasn't, leave it deferred and move on.

## Status of the 50-risk initiative

- ✅ **Batch A** (PR #66, merged) — 119 tripwire tests added across 13 file clusters. 25 risks closed.
- ✅ **Batch B** (PR #67, merged) — 8 production-code fixes + CI cleanup. 9 risks closed (B11 gitleaks reverted; Playwright ADVISORY job removed).
- ⏸ **Batch C** — deferred wholesale. All 11 items tracked below.
- ⏸ **Batch B carry-over** — 2 items deferred at decision time (B6 CSP enforce-flip, B7 title-gen rate-limit accounting).

**Risks fully closed:** ~34 of 50. **Risks tracked-but-deferred:** 13. **Risks dropped as not-applicable:** ~3 (e.g. crisis-routing-related, Critical-priority dead code removal).

## Triage table

| ID | Item | Severity | Trigger to revisit | Effort |
|---|---|---|---|---|
| **B6** | Flip CSP from report-only to enforce | HIGH | Post-beta; once a CSP-report-only week has produced clean reports | ~½ day |
| **B7** | Title-gen rate-limit accounting (separate bucket OR low-priority semaphore) | MEDIUM | First time you ramp past ~20 concurrent users on continued sessions | ~½–1 day |
| **C1** | Live-stack E2E suite (real Supabase + real Anthropic against staging) | CRITICAL (E2E layer) | 20+ active users AND a CI bill is justifiable | 1–2 days + ongoing maintenance |
| **C2** | Mailosaur signup→verify-link live flow | CRITICAL (E2E layer) | First tester churn report blamed on broken email | 2–3 days incl. inbox setup |
| **C3** | Cross-tenant live E2E (two real user fixtures hitting staging) | CRITICAL (E2E layer) | Real adversarial threat model emerges (enterprise sale, security audit) | 1 day |
| **C4** | Onboarding full-flow E2E (walks all 4 screens, asserts final PATCH) | HIGH (E2E layer) | First onboarding-screen change after beta launch | ½ day |
| **C5** | k6 load harness — one harness, multiple scenarios (p99, pool, breaker, rate-limit overhead, Anthropic brownout) | CRITICAL (LOAD layer) | Scale-up beyond ~20 concurrent users, OR before any code change touching `src/web-api/routes.ts` chat-turn handler at scale | 3–4 days |
| **C6** | testcontainers-postgres for RLS integration tests | MEDIUM (was HIGH; verifier-adjusted) | Tightening the Postgres connection role to drop BYPASSRLS (currently the app role bypasses RLS by design) | 1 day setup + ongoing |
| **C7** | Cross-browser + cross-viewport (Webkit + Firefox + desktop) Playwright projects | MEDIUM (E2E layer) | First tester reports a Safari or Firefox issue | 4h + debug time |
| **C8** | @axe-core/playwright accessibility smoke (auth + onboarding + chat) | MEDIUM (E2E layer) | Targeting regulated buyers (gov, healthcare, edu) | ½ day |
| **C9** | No-PII-to-LLM E2E canary (request-body assertion at wire layer) | MEDIUM (E2E layer) | Defense-in-depth — the unit test in `tests/prompt-assembly/pii-discipline.test.ts` (Batch A C1) already covers this. Pick up if a PR ever bypasses prompt-assembly | 4h |
| **C10** | Event-loop ELU monitoring + microbenchmark for 50k-token prompt assembly | LOW (LOAD layer, beta-adjusted) | ~50 concurrent users sustained | ½ day |
| **C11** | emitTurnTrace ingest backpressure counter (was B12) | MEDIUM (LOAD layer) | First Axiom ingest incident observed in production | ½ day |

## Why "defer everything" was the right call for the 5-tester beta

Three reasons captured here so the next session doesn't second-guess:

1. **Most Batch C items are sized for "we're scaling to 100 paying users this month."** The beta is 5 testers. Building infrastructure for traffic patterns we won't see is over-engineering.
2. **No engineers to maintain CI infrastructure.** A live-stack E2E suite that runs nightly needs someone to babysit when it flakes. That kind of "1 green 1 red" noise is exactly what we just removed from CI (Batch B closeout).
3. **The Batches A + B foundation is already strong.** 385 backend tests + 124 frontend tests + 8 production-code hardening fixes catch every regression that matters for 5 testers.

## How to pick an item back up

When a trigger fires:

1. Find the row in the table above.
2. Read the matching audit row in the conversation transcript from 2026-06-01 (search for `50-risk audit` or the item ID like `C5`).
3. The audit row has the full *risk / implications / audit-question / control-recommendation* breakdown a future-PM needs to scope the work.
4. Build the item as its own ticket / PR. Don't bundle Batch C items together — each has its own integration surface.
5. Remove the item's row from this file in the same PR that ships the fix.

## Closing the 50-risk initiative

This file ships in PR #68 (`docs/post-beta-hardening-tracker`). With its merge the initiative is **closed**. The next time someone asks *"what was the test-coverage audit you ran in May 2026?"* — point them here.

Future audits should follow the same shape: multi-agent risk-mapping workflow → PM-approved decision tables → batched parallel implementation with adversarial verify → single-PR review surface per batch. Audit-evidence files belong in `audit-evidence/` (gitignored locally; regenerated by `withEvidence` helper).
