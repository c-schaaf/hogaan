# 05 — Session Lifecycle

**Status:** living contract — update in the same PR that changes this process.
**Last reviewed:** 2026-05-19 (updated per SCRUM-54: no-sessionId always creates new).

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
        └── no sessionId ──▶ always INSERT a new session row
                              (SCRUM-54 — matches ChatGPT mental model:
                              a new conversation starts iff the client
                              doesn't name an existing one)
```

The WhatsApp-era 30-min auto-continue lookup was removed in SCRUM-54. The
homepage and the explicit "New Chat" button both rely on the server creating
a fresh session whenever the client omits `sessionId` from the request.

## Why the silent fall-through on foreign sessionId

A 404 on a sessionId that doesn't belong to the requesting user would tell an
attacker which IDs *do* exist for other users (presence oracle). Falling
through to the no-sessionId path means the user gets the same UX as if no
sessionId had been sent — a fresh session — with no information disclosure.

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
| INSERT new session | DB error | 5xx; Sentry P2 |
| Concurrent inbound from same user without sessionId | Two requests in flight | Two new sessions are created — by design after SCRUM-54, since no-sessionId always means "new conversation" |

## Test coverage

- **Unit:** [`tests/session-lifecycle/resolver-sessionid.test.ts`](../../tests/session-lifecycle/resolver-sessionid.test.ts) — every branch of the resolver (owned-open, owned-closed reopen, foreign fall-through, fabricated fall-through, no-sessionId always-new).
- **Integration:** [`tests/web-api/routes-chat-continue.test.ts`](../../tests/web-api/routes-chat-continue.test.ts) — the route forwards `body.sessionId` into `resolveSession`; empty/non-string values are treated as absent.
- **E2E:** [`tests/e2e/sessions/continue-honors-session-id.spec.ts`](../../tests/e2e/sessions/continue-honors-session-id.spec.ts) — round-trip from sessions list click → stream → no duplicate row after refresh.

## Key files

- `src/session-lifecycle/resolver.ts`
- `src/session-lifecycle/close.ts`
- `src/session-lifecycle/recent.ts`
- `src/session-lifecycle/types.ts`
- `src/shared/db/schema/sessions.ts`

## Known issues

_None open. SCRUM-54 (explicit "New Chat" button + homepage always-new) shipped 2026-05-19._
