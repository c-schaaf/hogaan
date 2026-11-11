# 02 — Coaching Turn

**Status:** living contract — update in the same PR that changes this process.
**Last reviewed:** 2026-11-11 (context-and-connections build: privacy filter, cached system blocks, configurable chat model, demo mode).

## Purpose

Take one user message in the browser and return one coach response, streamed
token-by-token, within p99 ≤ 3 s.

## Entry point

`POST /api/chat/turn/stream` — Server-Sent Events response. **This is the only
chat path.** The legacy non-streaming `POST /api/chat/turn` route + its
orchestrator (triage / tagger / quality-check) were removed in SCRUM-43.

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
        │   - load active library versions (prompt_templates)
        │   - build memory block (BPMN 04)
        │   - build session-context block (last 3–5 turns)
        │   - build user-profile block (experience, role)
        │   - build current-user-message block
        │   - concatenate in canonical order
        │   - ALSO split into provider blocks: [library template (+ knowledge
        │     digest)] marked trusted + prompt-cached, then [per-leader blocks]
        │   - compute determinism hash
        │   - fire-and-forget log write
        ▼
[D2 privacy filter inside shared/llm/chat.ts]
        │   - strips email addresses, phone numbers, surnames from the
        │     messages and every non-library system block
        │   - library blocks (founder content) pass through unchanged
        ▼
[Stream LLM call via shared/llm/chat.ts → LLM_CHAT_MODEL]
        │   - default claude-haiku-4-5; claude-haiku-5-5 opt-in (P1.5)
        │   - demo mode with no key: scripted stand-in coach (never in production)
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

- **No triage / intent classification.** Code removed in SCRUM-43.
- **No quality check / response grading.** Code removed in SCRUM-43.
- **No tagger.** Code removed in SCRUM-43.
- **No v1 multi-block prompt assembly path.** Code removed in SCRUM-47; the
  unified `coaching_v3_leadership` template is the only assembly path now.
- **No crisis routing in code or in the prompt.** SCRUM-50 removed the
  embedded Crisis Protocol; the onboarding AI disclaimer covers legal
  exposure and §6 of the system prompt carries the one-line "not the
  right help — refer and stop" policy.
- **No token budget.** Removed in SCRUM-55; Haiku 4.5's 200k context dwarfs
  any realistic prompt.

## Failure modes

| Step | Failure | Behaviour |
|---|---|---|
| Auth | Missing / invalid JWT | 401 before any LLM call |
| LLM stream | Model declines (`stop_reason: refusal`, Haiku 5.5) before any text | Treated as content filter → non-streaming fallback → safe template |
| Resolve session | DB error | 5xx; Sentry P2 |
| Assemble prompt | Library load failure (E6) | Throws `PromptAssemblyError`; route emits SSE `event: error` |
| Assemble prompt | Template missing for response mode (E8) | Same |
| Assemble prompt | Malformed input (E5) | Same |
| LLM stream | Anthropic 5xx / timeout | Stream emits `event: error`; client renders fallback copy |
| Persist turn | DB error | Stream still emits `event: end` if response was complete; failure traced |

## Key files

- `src/web-api/routes.ts` — `POST /api/chat/turn/stream` handler
- `src/session-lifecycle/resolver.ts`
- `src/prompt-assembly/assembler.ts`
- `src/shared/llm/chat.ts` (model choice, privacy filter, scripted demo coach)
- `src/shared/pii/filter.ts` (D2 filter)
- `src/shared/db/schema/turns.ts`, `sessions.ts`

## Known issues

- **SCRUM-50** — Active prompt includes a crisis-protocol section. To be
  rewritten as leadership-only.
