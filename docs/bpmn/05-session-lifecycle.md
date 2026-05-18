# 05 — Session Lifecycle

**Status:** living contract — update in the same PR that changes this process.
**Last reviewed:** 2026-05-18 (updated per SCRUM-53 fix).

## Purpose

Decide whether an incoming message belongs to an existing conversation or
starts a new one. Manage open / closed / archived states.

## Process flow

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
        ├── sessionId provided BUT not owned (or fabricated) ──▶
        │         fall through silently (no 404 — avoids leaking
        │         session existence across users)
        │
        └── no sessionId ──▶ legacy time-based logic:
                  - SELECT user's most-recent OPEN session
                  - if found AND lastTurnAt ≤ 30 min ago → continue it
                  - else: close the stale one, INSERT a new row
```

## Why the silent fall-through on foreign sessionId

A 404 on a sessionId that doesn't belong to the requesting user would tell an
attacker which IDs *do* exist for other users (presence oracle). Falling
through to legacy logic means the user gets the same UX as if no sessionId
had been sent — typically a fresh session — with no information disclosure.

The legitimate "client UI somehow sent a stale/fabricated id" case lands in
the same place, and the user simply gets a new conversation. Acceptable.

## Other operations

- **Close session** (`src/session-lifecycle/close.ts`) — explicit close on
  user action (e.g. delete) or background job.
- **List recent** (`src/session-lifecycle/recent.ts`) — feed for the sessions
  list view.

## Failure modes

| Step | Failure | Behaviour |
|---|---|---|
| Named-session SELECT | DB error | 5xx; Sentry P2 |
| Reopen UPDATE (clearing closedAt) | DB error | 5xx; Sentry P2 |
| Legacy SELECT | DB error | 5xx; Sentry P2 |
| INSERT new session | DB error | 5xx; Sentry P2 |
| UPDATE closedAt on idle | DB error | 5xx; Sentry P2 |
| Concurrent inbound from same user without sessionId | Two requests in flight | Race may produce two new sessions; rare at our scale per resolver's file header |

## Test coverage

- **Unit:** [`tests/session-lifecycle/resolver-sessionid.test.ts`](../../tests/session-lifecycle/resolver-sessionid.test.ts) — every branch of the resolver (owned-open, owned-closed reopen, foreign fall-through, fabricated fall-through, legacy 30-min auto-split).
- **Integration:** [`tests/web-api/routes-chat-continue.test.ts`](../../tests/web-api/routes-chat-continue.test.ts) — the route forwards `body.sessionId` into `resolveSession`; empty/non-string values are treated as absent.
- **E2E:** [`tests/e2e/sessions/continue-honors-session-id.spec.ts`](../../tests/e2e/sessions/continue-honors-session-id.spec.ts) — round-trip from sessions list click → stream → no duplicate row after refresh.

## Key files

- `src/session-lifecycle/resolver.ts`
- `src/session-lifecycle/close.ts`
- `src/session-lifecycle/recent.ts`
- `src/session-lifecycle/types.ts`
- `src/shared/db/schema/sessions.ts`

## Known issues

- **SCRUM-54** (Medium, Story) — Add explicit "New Chat" button so users can
  deliberately start a new session even when an open one exists within the
  30-min window.
