# Hogaan — Project Guide for Claude

WhatsApp-native leadership coaching app. Delivers Hamse Warfa's twelve-practice framework to Somali professionals. Sponsor-funded (no end-user payments). Home-market MVP: Mogadishu and Hargeisa, English-only v1.

## Read before changing behavior

| When working on... | Read first |
|---|---|
| First session in this repo | `docs/Hogaan_PRD_v1.docx` — Exec Summary + Section 1 |
| A specific process | the matching BPMN file (see below) |
| Voice or coaching content | PRD Section 7 (Voice Rules + Cultural Framing) |
| Architecture decisions | PRD Section 6 |
| Scope boundaries | PRD Section 3 |
| Sponsor / business logic | PRD Section 8 |

BPMN files are the engineering contract — **open the BPMN before writing code for a process**. They live at `docs/bpmn/`:

- `Process_01_UserOnboarding.bpmn`
- `Process_02_CoachingConversation.bpmn` *(primary inbound message handler)*
- `Process_09_PromptAssembly.bpmn`
- `Process_10_ResponseQualityCheck.bpmn`
- `Process_11_WhatsAppMessageDelivery.bpmn`
- `Process_12_UserAuthIdentity.bpmn`

## Stack (locked — do not suggest alternatives)

Node 22 LTS · TypeScript strict · Fastify · Render (host) · Supabase Postgres + pgvector · Upstash Redis · Anthropic Claude Haiku 4.5 (coaching LLM) · Llama 3.3 70B on Groq (intent classifier + fallback) · Voyage `voyage-3-lite` (embeddings, 1024-dim) · Twilio WhatsApp Business API (+254 sender) · Sentry · Axiom · BetterStack.

**Never use Baileys or any reverse-engineered WhatsApp library.** Account-ban risk; non-negotiable.

## Module layout (modular monolith)

```
src/
├── onboarding/        # Process #1
├── coaching/          # Process #2 — inbound message entry point
├── prompt-assembly/   # Process #9
├── quality-check/     # Process #10
├── whatsapp-delivery/ # Process #11 + Twilio webhook receiver
├── identity/          # Process #12 — audit log is fail-CLOSED
├── memory/            # pgvector read/write
├── sponsor-portal/    # web admin UI (sponsors + ops)
└── shared/            # types, LLM wrappers, observability, secrets
```

## Common commands

```bash
pnpm install
pnpm dev              # hot-reload dev server
pnpm test             # all tests
pnpm test:bpmn        # BPMN process integration tests
pnpm lint             # ESLint + Prettier
pnpm typecheck        # tsc --noEmit
pnpm db:migrate       # Supabase migrations
pnpm build            # production build
```

## Hard rules

1. **Crisis routing supersedes everything.** Process #2 Step 1 + Process #10 Check 6. False positives are acceptable; false negatives are catastrophic. Never bypass for cost, latency, or convenience.
2. **Latency budget is a product requirement.** Total turn time p99 ≤ 6000ms. Primary LLM hard cap 5000ms, then fallback path. Don't add features that breach this without redesigning the budget.
3. **Voice Rules and Cultural Framing libraries are Hamse-owned.** Do not edit content under `src/coaching/libraries/` without his sign-off. Every change is a new library version (logged per-prompt for traceability).
4. **PII discipline.** Phone numbers hashed for IDs; plaintext stored encrypted at column level. No PII beyond first name reaches LLM providers. Audit-log writes in Process #12 are fail-closed.
5. **Sponsors never see individual user data.** Aggregate-only reporting, minimum 30 active users per segment.
6. **WhatsApp idempotency on every outbound.** Process #11 enforces a triple check — never add a new outbound path that bypasses it.

## Code conventions

- TypeScript strict mode; `any` requires a justifying comment.
- LLM calls go through `src/shared/llm/` (timeout + retry + fallback wrappers). Don't call providers directly.
- Every turn emits a structured trace via `src/shared/trace/`. Use it; don't invent ad hoc logging.
- Fail-open vs fail-closed is per-process and deliberate — see the BPMN. Don't change failure semantics without re-reading the BPMN.

## Ask before doing

- Feature not in PRD scope (Section 3) → confirm scope before building
- Schema change → migration + review
- Prompt template structure or library content change → Hamse's call, not engineering's
- Anything touching the +254 WhatsApp sender registration → operational decision