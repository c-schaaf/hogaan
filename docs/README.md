# Hogaan — docs

Welcome. If you are new to this repo, **read in this order:**

1. **[`/CLAUDE.md`](../CLAUDE.md)** at the repo root — the master guide. Stack,
   module layout, the 8-gate pipeline every ticket flows through, hard rules,
   conventions. ~5 minutes to read; everything else builds on this.

2. **[`bpmn/`](./bpmn/)** — the living-contract process docs. Read the one
   that matches what you're about to change:
   - `01-web-auth-onboarding.md` — signup, email verify, onboarding
   - `02-coaching-turn.md` — the chat turn (auth → assemble prompt → LLM stream → persist)
   - `03-identity-audit.md` — JWT validation + fail-closed audit log
   - `04-memory-recall-store.md` — pgvector recall + store
   - `05-session-lifecycle.md` — when a message starts a new session vs continues
   - `06-leader-brief-and-background-jobs.md` — leader brief + job runner (flagged)
   - `07-moments-and-follow-up.md` — moments, follow-up email, reflections (flagged)
   - `08-mcp-server.md` — Hogaan MCP server (flagged)
   - `09-billing-and-entitlements.md` — subscriptions + free tier (flagged)
   - `10-orgs-and-impact-reporting.md` — cohorts + funder report (flagged)

   The context-and-connections build plan and its report live in `plans/`.
   Try everything without accounts: `pnpm demo`.

   **Rule:** if you change a process, update its BPMN in the same PR. A PR that
   modifies a process without its BPMN diff fails gate G5.

3. **Jira** — the live backlog. Active sprint + post-launch cleanup tickets
   live there. CLAUDE.md describes the 8 gates each Jira ticket flows through.

## What's elsewhere in this folder

- `runbooks/` — operational runbooks (incident response, on-call, deploy).
- `voice-framework-workspace.md` — Hamse's working notes on the voice/voice-rules library.

(Removed 2026-06-01: `qa-prompts/` — one-off bug-hunt chunks from earlier
phases, served their purpose. `Hogaan_PRD_v1.docx` — legacy PRD about the
WhatsApp era, was actively misleading new contributors. `design-prompts/` —
forward-looking marketing-site design briefs, never committed; lived locally
only. `audit-evidence/` — 723 historical test-evidence JSON files; the
`withEvidence` helper still writes locally but no longer commits.)

## How docs stay accurate

The BPMNs + CLAUDE.md are living contracts. Whenever you touch a process or a
convention, update the doc in the **same PR** as the code. G5 of the pipeline
won't pass otherwise.

If you find a doc that's wrong, the fix is one PR: update the doc, link the PR
to whatever code change made it wrong, merge. Don't let drift accumulate.
