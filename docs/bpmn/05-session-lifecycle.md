# 05 — Session Lifecycle

**Status:** living contract — update in the same PR that changes this process.
**Last reviewed:** 2026-05-18

## Purpose

Decide whether an incoming message belongs to an existing conversation or
starts a new one. Manage open / closed / archived states.

## ⚠️ KNOWN ISSUE — see SCRUM-44

The current resolver **ignores the `sessionId` field sent by the browser** and
makes session continuation a function of elapsed time only. This breaks
"Continue past session" (the UI loads the past session's history; the new turn
silently lands in a different session row).

The flow below documents the **current buggy behaviour**. Ticket SCRUM-44 will
rewrite `resolveSession` to honour the client `sessionId`, and this BPMN will
be updated in the same PR.

## Process flow (current — buggy)

```
[POST /api/chat/turn/stream with optional sessionId]
        │
        ▼
[resolveSession is called — sessionId from body is IGNORED]
        │
        ▼
[SELECT user's most recent session WHERE closedAt IS NULL]
        │
        ├── found AND lastTurnAt within 30 min ──▶ return { isNew: false, that session id }
        │
        ├── found BUT lastTurnAt > 30 min ago ──▶ UPDATE that session SET closedAt = lastTurnAt
        │                                          fall through to create new
        │
        └── none open ──▶ fall through to create new
        │
        ▼
[INSERT new session row { userId, startedAt: now, lastTurnAt: now, turnCount: 0 }]
        │
        ▼
[return { isNew: true, new session id }]
```

## Process flow (after SCRUM-44 lands — target)

```
[POST /api/chat/turn/stream with optional sessionId]
        │
        ▼
[resolveSession]
        │
        ├── sessionId provided AND belongs to this user ──▶
        │         if closed: clear closedAt (reopen)
        │         return { isNew: false, that session id }
        │
        └── sessionId not provided ──▶ legacy time-based logic above
```

## Other operations

- **Close session** (`src/session-lifecycle/close.ts`) — explicit close on
  user action (e.g. delete) or background job.
- **List recent** (`src/session-lifecycle/recent.ts`) — feed for the sessions
  list view.

## Failure modes

| Step | Failure | Behaviour |
|---|---|---|
| SELECT recent session | DB error | 5xx; Sentry P2 |
| INSERT new session | DB error | 5xx; Sentry P2 |
| UPDATE closedAt on idle | DB error | 5xx; Sentry P2 |
| Concurrent inbound from same user | Two requests in flight | Race may produce two new sessions; rare at our scale per file comment |

## Key files

- `src/session-lifecycle/resolver.ts`
- `src/session-lifecycle/close.ts`
- `src/session-lifecycle/recent.ts`
- `src/session-lifecycle/types.ts`
- `src/shared/db/schema/sessions.ts`

## Known issues

- **SCRUM-44** (High, Bug) — Honour client sessionId; "Continue past session"
  currently broken.
- **SCRUM-45** (Medium, Story) — Add explicit "New Chat" button so users can
  deliberately start a new session.
