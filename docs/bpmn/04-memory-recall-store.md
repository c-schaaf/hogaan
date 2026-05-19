# 04 — Memory Recall + Store

**Status:** living contract — update in the same PR that changes this process.
**Last reviewed:** 2026-05-19 (path fixups for memory/{read,write}.ts).

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
[Voyage embed the user message] (voyage-3-lite, 1024-dim)
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
- `src/shared/db/schema/memory.ts`

## Known issues

- **SCRUM-9** — Voyage rate-limit headroom unverified at our tier. Pre-launch
  check.
