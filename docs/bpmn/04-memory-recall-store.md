# 04 — Memory Recall + Store

**Status:** living contract — update in the same PR that changes this process.
**Last reviewed:** 2026-11-11 (P0.3 — recorded that this process is switched off).

> **Current state: OFF.** Recall is disabled on the live chat path
> (`src/web-api/routes.ts` passes `memoryTopN: 0`, so no Voyage call and no
> pgvector search happens) and the store path below has **no caller** —
> `src/memory/write.ts` is never invoked. The diagrams describe the designed
> process, not what runs today. Model is `voyage-3` (1024-dim), not
> `voyage-3-lite`. The table is `memories`, not `memory_embeddings`. See the
> leader-brief process in BPMN 06 (Phase 1 of the context build plan): the
> brief is now the primary memory mechanism, read with one primary-key
> lookup instead of a ~300 ms embedding call. pgvector memory stays as a
> possible secondary way to pull up one specific past conversation.

## Purpose

Give the coach continuity across sessions by storing each turn as a pgvector
embedding and recalling the most semantically relevant past turns when the
user asks something new.

## Two sub-processes

### Recall (during prompt assembly — BPMN 02 step 3)

```
[user message arrives in the coaching turn]
        │
        ▼
[Voyage embed the user message] (voyage-3, 1024-dim)
        │
        ▼
[pgvector cosine-similarity search on memory_embeddings table]
        │   - filter by userId
        │   - return top-N by similarity (current default: 10)
        ▼
[buildMemoryBlock formats results]
        │   - sort by createdAt desc
        │   - render one line per memory: `- (YYYY-MM-DD) <summary>`
        ▼
[block injected into prompt-assembly memory section]
```

### Store (after a successful coaching turn)

```
[turn persisted in BPMN 02]
        │
        ▼ (async, fire-and-forget — does not block response)
[summarize turn into a one-line memory candidate]
        │
        ▼
[Voyage embed the summary]
        │
        ▼
[INSERT into memory_embeddings]
        │   - userId, content (the summary), embedding, createdAt
        ▼
[done]
```

## Failure modes

| Step | Failure | Behaviour |
|---|---|---|
| Voyage embed (recall) | API error / rate limit | Memory block returns "(no prior memories retrieved)"; turn proceeds |
| pgvector search | DB error | Same as above |
| Voyage embed (store) | API error | Memory not stored for this turn; Sentry P2; user-facing turn unaffected |
| memory_embeddings INSERT | DB error | Same |

## Sensitive defaults

- Recall cap = 10 memories per turn. Larger caps inflate prompt cost without
  proportional quality gain.
- Stored memory is a one-line summary, **not** the raw turn text — PII
  discipline applies.

## Key files

- `src/memory/read.ts` — embed + similarity search
- `src/memory/write.ts` — embed + insert
- `src/prompt-assembly/blocks.ts` — `buildMemoryBlock`
- `src/shared/llm/voyage.ts` — Voyage embeddings wrapper
- `src/shared/db/schema/memories.ts`

## Known issues

- **SCRUM-9** — Voyage rate-limit headroom unverified at our tier. Pre-launch
  check.
