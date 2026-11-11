# 06 — Leader Brief + Background Jobs

**Status:** living contract — update in the same PR that changes this process.
**Last reviewed:** 2026-11-11 (created in the context-and-connections build, P1.1–P1.4, P2.5).
**Flags:** `FEATURE_LEADER_BRIEF`, `FEATURE_KNOWLEDGE_DIGEST` (both default off).

## Purpose

Make "remembers your context across conversations" true without adding a
step to the chat turn. A short, encrypted, leader-editable brief is
rewritten in the background after each session and read (one primary-key
lookup) at the start of each turn.

## Read path (inside the chat turn — BPMN 02)

```
[context fetch, in parallel with profile + recent turns]
        │   SELECT leader_briefs WHERE user_id = $1   (only if flag on)
        │   decrypt → render "## What you know about this leader"
        │   timeout 1500 ms → fail-soft to '' (turn proceeds without it)
        ▼
[prompt assembly] block placed AFTER the cache breakpoint
        │   [template + approved knowledge digest] (cached, trusted)
        │   [brief + session + profile + message]
        ▼
[D2 privacy filter → model]
```

## Write path (never inside the chat turn)

```
[turn persisted, not private, flag on]
        │  enqueue brief.update, dedupe_key = brief:<sessionId>,
        │  mode = replace, run_after = now + BRIEF_UPDATE_DELAY_MS (10 min)
        │  (each new turn re-arms the same job → runs once the leader goes quiet)
        ▼
[job runner tick (every JOB_POLL_INTERVAL_MS)]
        │  claim due jobs: UPDATE … SET status='running' WHERE status='pending'
        ▼
[brief.update]
        │  skip if session private / missing / empty
        │  load turns + current brief; strip PII; call background model
        │  (LLM_BACKGROUND_MODEL = claude-opus-5-5, structured JSON output)
        │  merge: leader lines + reflection lines untouched; fields only filled
        │  when empty; PII filter on every stored string
        │  save (AES-256-GCM per document)
        ▼
[moments extracted from the same call → BPMN 07]
```

## Leader controls (P1.3)

`GET/PATCH/POST/DELETE /api/brief…` — view, edit or delete any line, edit
work-context fields, delete everything. Edited lines become `source: leader`
and the updater never rewrites them.

## Failure modes

| Step | Failure | Behaviour |
|---|---|---|
| Brief read | DB error / timeout | Fail-soft: turn continues without the block; `contextFetchPartial` trace flag |
| Enqueue | DB error | Fail-open: P2 incident, turn unaffected |
| Background model | error / no key | Job retried with backoff (1 min, 2 min); after 3 attempts `failed` + P2. Chat unaffected |
| Process crash mid-job | — | `running` jobs older than 10 min are reset to `pending` |

## Key files

- `src/leader-context/` — types, store (encryption), render, updater
- `src/jobs/runner.ts`, `src/jobs/handlers.ts`
- `src/libraries/knowledge-digest.ts` (mechanism; content is Hamse's)
- `src/web-api/context-routes.ts`
- `drizzle/0018_leader_context.sql`
