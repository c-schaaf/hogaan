# 01 — Web Auth + Onboarding

**Status:** living contract — update in the same PR that changes this process.
**Last reviewed:** 2026-05-18

## Purpose

Take a new user from "never heard of Hogaan" to "ready to chat with the coach"
in a single browser session at hogaanai.com.

## Entry points

- `GET /` — landing on the web SPA. If no Supabase session, show signup/login.
- Email magic-link or password reset callback URLs into Supabase Auth.

## Process flow

```
[user lands on web app]
        │
        ▼
[has Supabase session?] ── yes ──▶ [profile complete?] ── yes ──▶ Chat (BPMN 02)
        │ no                              │ no
        ▼                                  ▼
[Signup screen]                     [Onboarding step 1: first name]
        │                                  │
        ▼                                  ▼
[POST signup → Supabase Auth]       [Onboarding step 2: years of leadership]
        │                                  │
        ▼                                  ▼
[Resend verification email          [Onboarding step 3: pick 12 practices]
 sent via src/shared/email/]               │
        │                                  ▼
        ▼                            [Onboarding step 4: AI-disclaimer consent]
[user clicks magic link]                   │
        │                                  ▼
        ▼                            [PATCH profile → persist onboarding state]
[Supabase callback verifies token]         │
        │                                  ▼
        ▼                            [Completion screen]
[session cookie set]                       │
        │                                  ▼
        └────────────────────────────▶  Chat (BPMN 02)
```

## Failure modes

| Step | Failure | Behaviour |
|---|---|---|
| Resend email send | Rate-limit or DNS misconfig | Show generic "check your inbox" copy; trace to Sentry; user can request resend after 30s |
| Magic-link click | Token expired | Redirect to signup with `?error=link_expired` |
| Practice selection | Fewer than required selected | Client-side validation blocks Next button |
| Consent | Not ticked | Submit button disabled |
| Persistence | DB write fails | Show retry; do not advance phase until persisted |

## Key files

- `src/web-api/routes.ts` — `/api/auth/*`, `/api/profile`
- `src/onboarding/` — server-side onboarding validation
- `web/src/phases/Signup.tsx`, `Login.tsx`, `EmailVerify.tsx`, `Onboarding.tsx`
- `src/identity/` — Supabase JWT validation, audit log
- `src/shared/email/` — Resend wrapper

## Known issues

None as of 2026-05-18.
