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

   **Rule:** if you change a process, update its BPMN in the same PR. A PR that
   modifies a process without its BPMN diff fails gate G5.

3. **Jira** — the live backlog. Active sprint + post-launch cleanup tickets
   live there. CLAUDE.md describes the 8 gates each Jira ticket flows through.

## What's elsewhere in this folder

- `runbooks/` — operational runbooks (incident response, on-call, deploy).
- `qa-prompts/` — content-quality QA prompts used by Hamse and content reviewers.
- `voice-framework-workspace.md` — Hamse's working notes on the voice/voice-rules library.
- `Hogaan_PRD_v1.docx` — legacy PRD. Predates 2026-05-13 simplifications and
  the audience broadening. **Do not treat as source of truth.** It's retained
  for historical reference only; CLAUDE.md + the BPMNs above are canonical.

## How docs stay accurate

The BPMNs + CLAUDE.md are living contracts. Whenever you touch a process or a
convention, update the doc in the **same PR** as the code. G5 of the pipeline
won't pass otherwise.

If you find a doc that's wrong, the fix is one PR: update the doc, link the PR
to whatever code change made it wrong, merge. Don't let drift accumulate.
