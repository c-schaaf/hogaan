# 03 — Identity + Audit Log

**Status:** living contract — update in the same PR that changes this process.
**Last reviewed:** 2026-05-19

## Purpose

Validate every authenticated HTTP request's Supabase JWT, resolve the user, and
write a fail-closed audit log row before the request proceeds.

## Trust boundary

Every route under `/api/*` (except `/healthz`, `/readyz`) must call
`requireSupabaseSession` before doing anything user-affecting. No exceptions.

## Process flow

```
[HTTP request hits /api/*]
        │
        ▼
[requireSupabaseSession]
        │   - read Authorization: Bearer <jwt> or session cookie
        │   - verify signature against Supabase JWKS (cached)
        │   - check exp / iat
        │   - resolve userId from claims
        │   - upsert public.users row if missing
        │      (relink on email collision per src/web-api/supabase-session.ts)
        ▼ fail → 401, return; reply.send was called
        │
        ▼
[audit-log write — FAIL-CLOSED]
        │   - INSERT into audit_logs with userId, route, request id, timestamp
        │   - if write fails, the request fails too (no proceeding)
        ▼
[handler runs with verified session]
```

## Fail-closed contract

The audit log write **must succeed** before any state-changing handler runs.
If the DB write fails, the request returns 5xx. This is per CLAUDE.md Hard
Rule 3.

Rationale: audit logs are required for incident review. A handler that ran
without being logged is invisible to ops and to any future trust audit.

## Failure modes

| Step | Failure | Behaviour |
|---|---|---|
| JWT signature invalid | tampered/expired token | 401, no log |
| JWT exp passed | normal expiry | 401, no log; client re-auths via Supabase refresh |
| JWKS fetch fails | Supabase outage | 5xx; Sentry P1 |
| `public.users` upsert | email collision with orphan | Relink per `supabase-session.ts:relinkOrphanUser` |
| audit_logs INSERT | DB down | 5xx; request rejected |

## Key files

- `src/web-api/supabase-session.ts` — JWT verification + user resolution
- `src/identity/audit.ts` — audit log write (fail-closed)
- `src/identity/token.ts` — legacy non-Supabase token path (sponsor portal era;
  unused but retained for now)
- `src/shared/db/schema/audit_logs.ts`

## Known issues

None. This module passed its 2026-05-13 review.
