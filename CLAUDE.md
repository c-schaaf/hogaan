# Hogaan — Project Guide for Claude

Hogaan Leadership is an AI-powered leadership coaching product founded by
Hamse Warfa (former U.S. State Department senior advisor). It delivers a
twelve-practice transformational leadership framework spanning four arenas:

- **Self** — purpose, integrity, accountability
- **Team** — dignity, empathy, inclusion
- **Organization** — assets, innovation, prosperity
- **Community** — humility, peace, democracy

Positioning: a pocket coach for the moments leadership programs miss — hard
conversations, stalled decisions, team dynamics. Audience: managers, founders,
and team leads who lack access to elite human coaching budgets.

End users sign in at hogaanai.com, complete onboarding, and converse with the
coach in the browser. **Leadership coaching only — not therapy, not crisis
support.** The AI disclaimer covers safety framing.

## What's shipped vs. on the roadmap

**Shipped today:**

- Web signup + email verification (Supabase Auth + Resend)
- Onboarding (first name, years of leadership, 12-practice selection, consent)
- On-demand text coaching (streaming single LLM call)
- Past sessions list + continue past session + delete
- Profile management

**On the roadmap (NOT in code yet — do not assume these exist):**

- Voice coaching
- Daily coaching prompts
- Paid tiers ($9–$19/month premium with personalized tracks)
- Cohort / certification offering
- User-facing rehearsal of difficult conversations (the prototype state
  machine was retired 2026-05-19; revisit when the feature ships)

## Read before changing behavior

| When working on… | Read first |
|---|---|
| First session in this repo | This file + `docs/README.md` |
| A specific process | The matching BPMN under `docs/bpmn/` |
| Voice or coaching content | `src/libraries/seed/` (Hamse-owned) |

BPMNs are **living contracts** — updated in the same PR that changes the
process. A code change to a process without its BPMN diff fails gate G5.

## Stack (locked — do not suggest alternatives)

Node 22 LTS · TypeScript strict · Fastify · React 18 + Vite · Render (host) ·
Supabase Postgres + pgvector · Supabase Auth · Upstash Redis · Anthropic Claude
Haiku 4.5 (coaching) · Llama 3.3 70B on Groq (fallback) · Voyage
`voyage-3-lite` (embeddings, 1024-dim) · Resend (transactional email) · Sentry
· Axiom · BetterStack.

## Module layout

```
src/
├── web-api/           # HTTP routes (chat, sessions, profile) — entry point for the browser app
├── onboarding/        # First-name, years, practice selection, consent
├── coaching/          # Legacy non-streaming orchestrator (vestigial; streaming path bypasses it)
├── prompt-assembly/   # Build the LLM prompt from libraries + session context
├── session-lifecycle/ # Active/idle/archive + continue-past-session
├── identity/          # Supabase JWT validation + audit log (fail-CLOSED)
├── memory/            # pgvector read/write
├── libraries/         # Voice rules + framework content (Hamse-owned)
└── shared/            # LLM wrappers, DB, Redis, observability, types, trace

web/src/               # React SPA — auth, onboarding, chat, profile, sessions
```

### The coaching turn (today)

`POST /api/chat/turn/stream`:

1. **Auth** — Supabase JWT validated by `requireSupabaseSession`.
2. **Resolve session** — `session-lifecycle/` (new vs continue).
3. **Assemble prompt** — `prompt-assembly/` builds the prompt from the active
   unified library template + memory + session + profile + user message.
4. **LLM stream** — single Haiku 4.5 streaming call via `shared/llm/chat.ts`.
5. **Persist** — turn + session row updated; session title generated async.
6. **Respond** — SSE chunks back to the browser.

No triage. No quality check. No tagger. The pre-2026-05-13 multi-step pipeline
was removed to cut p99 turn latency from ~6 s to under 3 s.

## The Pipeline — 8 gates

Every Jira ticket flows through these gates. **Stop at each gate package; wait
for the user's explicit go.** Never chain stages without approval.

| # | Stage | Agent produces | User's gate question |
|---|---|---|---|
| G1 | Ticket intake | Restated AC, scope boundary, files/processes touched, BPMN(s) affected | Right scope? Right BPMN(s)? |
| G2 | Design | Plan: files, reusable functions, regression risk, proposed BPMN diff if process changes | Approach correct? Regressions covered? |
| G3 | Implementation | Uncommitted diff | Code matches plan? No scope creep? |
| G4 | Local verification | `pnpm typecheck`, `lint`, `test`, `test:routes`, `test:e2e` all green; manual UI smoke if relevant | All green? Hard Rules respected? |
| G4.5 | Risk audit *(conditional — see triggers below)* | Audit table | Residual risks acceptable? |
| G5 | PR open | Branch + PR per convention; AC checklist; BPMN delta; rollback note; CLAUDE.md delta if conventions changed | PR self-contained? Living docs updated in same PR? |
| G6 | Merge | GitHub CI all green; squash-merge | Ready to deploy? |
| G7 | Deploy verification | Render deploy succeeded; Sentry quiet 10 min; smoke check on hogaanai.com; turn-latency p99 still ≤ 3s | Production healthy? |
| G8 | Close | Jira moved to Done, AC ticked, learnings → CLAUDE.md if pipeline-relevant | Done done? |

If any gate fails, loop back — never bypass. Never use `--no-verify` or skip
hooks.

### Tiered pipeline — pick the right ceremony for the ticket

Not every ticket needs eight gates. Triage tickets into three tiers:

| Tier | When to use | Gates run | Approval points |
|---|---|---|---|
| **Trivial chore** | ≤ 1 file, deletion-only, config / script removal, no behavior change. Examples: remove an unused dep, delete a dead script line, drop a vestigial folder. | G3 → G4 → G5 (commit + push) → G6 (CI green + merge) → G7 (deploy verified) | 1 — user reviews the PR once and merges |
| **Standard** | Bug fix or small feature with a clear AC. Examples: SCRUM-53 (session-id fix), SCRUM-54 (New Chat button). | All 8 gates | 4 packages (see below) |
| **Risky** | Anything triggering G4.5: auth, schema migrations, libraries, PII / audit-log, or Jira labels `launch-blocker` / `needs-decision` / `legal`. | All 8 gates + G4.5 | 4 packages + explicit G4.5 audit approval |

When in doubt, escalate one tier up, not down.

### Batch gate approvals (default for Standard / Risky tiers)

To cut interruptions, group the eight gates into four approval packages:

1. **Plan package** — G1 + G2. User says go once after seeing scope + design.
2. **Build package** — G3 + G4 (+ G4.5 if triggered). User says go once after seeing diff + green tests + audit table.
3. **Ship package** — G5 + G6. User reviews + merges the PR.
4. **Verify package** — G7 + G8. User confirms prod health + closes ticket.

Same rigor, half the round-trips. Use this as the default. If something
surprising surfaces mid-package (e.g. a regression, a missing AC), break out
of the package and surface immediately — don't bury the issue.

## G4.5 — Risk audit (conditional)

**Run G4.5 if the ticket touches any of:**

- `src/identity/` or any auth flow (trust boundary)
- Database migrations or schema changes
- `src/libraries/` (prompt / voice content)
- PII handling, encryption, or audit-log code
- Jira labels: `launch-blocker`, `needs-decision`, `legal`

**Audit table columns:** Risks · Implications · Audit Objectives · Audit
Procedures · Audit Questions · Audit Evidence · Control Recommendations.
*If no evidence exists for a control, the control is a hope, not a control.*

## Hard Rules — checked at G4 and G4.5

1. **Latency budget is a product requirement.** Total turn time p99 ≤ 3000 ms.
   No multi-step orchestration that breaches this.
2. **Voice Rules and library content are Hamse-owned.** Do not edit
   `src/libraries/seed/` content without his sign-off. Every change is a new
   library version, logged per-prompt for traceability.
3. **PII discipline.** Email and identifiers hashed for IDs; plaintext stored
   encrypted at column level. No PII beyond first name reaches LLM providers.
   Audit-log writes in `src/identity/` are fail-closed.
4. **No therapy / no crisis routing.** Leadership coaching only. The AI
   disclaimer covers safety framing. Do not add diagnostic, therapeutic, or
   crisis-detection features in code.
5. **Email idempotency.** Every outbound transactional email goes through
   `src/shared/email/` with idempotency. Never add a new outbound path that
   bypasses it.

## Code conventions

- TypeScript strict mode; `any` requires a justifying comment.
- LLM calls go through `src/shared/llm/`. Don't call providers directly.
- Every turn emits a structured trace via `src/shared/trace/`. Use it.
- Fail-open vs fail-closed is per-process and deliberate — see the matching
  BPMN before changing failure semantics.
- **Every ticket's AC names the new test(s) that prove the change.** Choose
  the lowest layer that catches the regression (unit > integration > E2E);
  add higher layers only when the lower one can't see the bug. G1 catches
  missing test specs and updates the ticket in-flight before any code is
  written.

## Branch + PR convention

- Branch: `<type>/<SCRUM-key>-<short-slug>` → e.g. `feat/SCRUM-44-session-id-honor`
- PR title: `<type>(<scope>): <imperative> (SCRUM-XX)`
- Types: `feat` `fix` `chore` `docs` `refactor` `test`
- Squash-merge to `main` → Render auto-deploys.

## Common commands

```bash
pnpm install
pnpm dev              # hot-reload backend + web
pnpm test             # vitest unit (backend + frontend)
pnpm test:routes      # vitest integration (web-api routes)
pnpm test:e2e         # Playwright e2e
pnpm test:all         # all of the above
pnpm lint             # ESLint + Prettier
pnpm typecheck        # tsc --noEmit
pnpm db:migrate       # Supabase / Drizzle migrations
pnpm build            # production build
```

## Ask before doing

- Feature not in the current Jira backlog → confirm scope before building.
- Schema change → migration + G4.5 audit.
- Library content change → Hamse's call.
- Launch-blocker ticket without explicit Jira green-light.
