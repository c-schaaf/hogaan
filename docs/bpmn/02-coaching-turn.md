# 02 — Coaching Turn

**Status:** living contract — update in the same PR that changes this process.
**Last reviewed:** 2026-05-18

## Purpose

Take one user message in the browser and return one coach response, streamed
token-by-token, within p99 ≤ 3 s.

## Entry point

`POST /api/chat/turn/stream` — Server-Sent Events response. The non-streaming
`POST /api/chat/turn` exists but is vestigial (legacy orchestrator).

## Process flow

```
[browser POSTs { message, sessionId?, private? }]
        │
        ▼
[Auth: requireSupabaseSession]
        │ fail → 401, return
        ▼
[Resolve session via session-lifecycle/] ─────────── (BPMN 05)
        │
        ▼
[Assemble prompt via prompt-assembly/]
        │   - load active library versions (system template, etc.)
        │   - build memory block (BPMN 04)
        │   - build session-context block (last 3–5 turns)
        │   - build user-profile block (experience, role, focus practices)
        │   - build current-user-message block
        │   - concatenate in canonical order
        │   - compute determinism hash
        │   - fire-and-forget log write
        ▼
[Stream LLM call via shared/llm/chat.ts → Anthropic Haiku 4.5]
        │   - hijack Fastify reply, write SSE headers (X-Accel-Buffering: no)
        │   - emit `event: start { sessionId }`
        │   - emit `event: delta { text }` per chunk
        ▼
[Persist turn + update session]
        │   - insert turn row
        │   - bump session.last_turn_at, turn_count
        │   - if first turn of session: kick off async title generation via Haiku
        ▼
[emit `event: end { turnId, sessionId, latencyMs }`]
        │
        ▼
[browser renders streamed text + final session state]
```

## What is NOT in this process today

- **No triage / intent classification.** Removed 2026-05-13.
- **No quality check / response grading.** Removed 2026-05-13.
- **No tagger.** Removed 2026-05-13.
- **No crisis routing in code.** (The active system prompt does include a
  crisis-protocol section. Ticket SCRUM-50 removes it.)

## Failure modes

| Step | Failure | Behaviour |
|---|---|---|
| Auth | Missing / invalid JWT | 401 before any LLM call |
| Resolve session | DB error | 5xx; Sentry P2 |
| Assemble prompt | Library load failure (E6) | Throw `PromptAssemblyError`; route returns templated fallback copy |
| LLM stream | Anthropic 5xx / timeout | Stream emits `event: error`; client renders fallback copy |
| LLM stream | Token limit / context error | Same as above |
| Persist turn | DB error | Stream still emits `event: end` if response was complete; failure traced |

## Key files

- `src/web-api/routes.ts` — `POST /api/chat/turn/stream` handler
- `src/session-lifecycle/resolver.ts`
- `src/prompt-assembly/assembler.ts`
- `src/shared/llm/chat.ts`
- `src/shared/db/schema/turns.ts`, `sessions.ts`

## Known issues

- **SCRUM-44** — `resolveSession` ignores client `sessionId`; "Continue past
  session" silently creates duplicate sessions. Fix in flight.
- **SCRUM-48** — Selected practices, comm style, response depth not piped into
  the LLM prompt. Personalization gap.
- **SCRUM-50** — Active prompt includes a crisis-protocol section. To be
  rewritten as leadership-only.
