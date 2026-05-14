# Hogaan — Bug Hunt Chunk 2: Auth Flows

## Your role

Senior QA engineer doing exploratory testing. Find and document bugs — do NOT fix anything. Produce a developer-ready report another engineer can action cold.

## The product

Hogaan is a React SPA (web-based leadership coaching). Local dev server: **http://localhost:3000**. Auth is Supabase Auth (browser-side magic link + password). The Shell.tsx phase orchestrator handles `login / signup / verify / forgot / reset / onboarding / home / chat / sessions / profile`.

## Test accounts

- **Primary account (onboarded):** `test@gmail.com` / `test123`
- **Fresh account for signup test:** use a real email you have access to, or use a `+alias` on the primary (e.g. `test+qa2@gmail.com`) if Supabase allows it — only if you can access the inbox to verify.

## What's deliberately disabled — DO NOT FLAG

- Coaching LLM quality (response tone, question count) — separate audit
- Practice tagger writes placeholder values — expected
- Streaming takes 1–2s to first token — expected

## Scope for THIS chunk: Auth only

**In scope:** login, logout, signup, forgot-password, password-reset, email-verify banner, session persistence across tabs, auth error banners.

**Out of scope:** chat quality, sessions list contents, profile editing — note those in "out of scope observations" but don't dive in.

**IMPORTANT: Do NOT sign out until Journey 5. All other journeys assume you remain signed in.**

---

## Journeys

### Journey 1 — Login happy path

1. Open `http://localhost:3000` fresh (no existing session). Verify you land on Login, not home.
2. Enter `test@gmail.com` / `test123`. Click Sign in.
3. Measure rough time from click → home screen renders (instant / <1s / 1–3s / >3s).
4. Verify: greeting appears, nav shows home/sessions/profile, no console errors.
5. **Refresh while on home.** Verify you stay on home — NOT bounced to login.

### Journey 2 — Login with wrong password

1. Sign out (skip to Journey 5 if you haven't signed out; or open a private/incognito window for this test).
2. Enter `test@gmail.com` and intentionally wrong password `wrongpass123`.
3. Click Sign in.
4. **Expected:** inline error message visible on the login screen.
5. **Capture:** exact error text shown, whether it's clear to a user (not an internal code like `invalid_credentials`).

### Journey 3 — Forgot-password flow

1. From Login, click the "Forgot password" or "Reset password" link.
2. Verify you land on the Forgot phase — not a blank screen or 404.
3. Enter `test@gmail.com`. Submit.
4. **Expected:** confirmation message that a reset email was sent (you don't need to actually receive or click the email — just verify the UI confirms success).
5. Click back to Login. Verify the back navigation works (no stuck state).

### Journey 4 — Signup + email-verify flow

1. Navigate to the Signup screen (from Login via "Create account" link).
2. Verify all fields render: name, email, password (at minimum).
3. Enter a name and a **fake/non-existent email** like `qa-nonexistent-1234@example.com` + any password meeting minimum length. Submit.
4. **Expected:** navigate to the verify-email phase showing instructions. The phase should NOT show a blank screen.
5. Verify the verify-email screen has a "Back" or "Try again" path — check it doesn't dead-end.
6. Click the back/retry link and verify you can get back to login without refreshing.

### Journey 5 — Sign out

1. From the primary account (`test@gmail.com`), sign in if not already.
2. Navigate to Profile. Find the sign-out button/link.
3. Click sign out.
4. **Expected:** immediate redirect to Login (or Signup). No lingering authed content.
5. Verify no authed API calls fire after sign-out (network tab: `/api/profile`, `/api/sessions` should NOT be called post-signout).
6. **Refresh after sign-out.** Verify you stay on Login — NOT silently re-authed.

### Journey 6 — Multi-tab session behaviour

1. Sign in in Tab A. Open Tab B (same browser, same origin). Verify Tab B shows home without re-login.
2. In Tab A, sign out.
3. Switch to Tab B. Trigger any navigation (click Sessions).
4. **Expected:** Tab B detects the session is gone and redirects to login. Or at least: the next authed API call returns 401 and Tab B gracefully shows login.
5. **Capture:** actual behaviour vs expected.

### Journey 7 — Auth error URL banner

1. Construct a URL with a simulated expired-link error: `http://localhost:3000/#error=access_denied&error_code=otp_expired&error_description=Link+has+expired`
2. Load this URL while NOT logged in.
3. **Expected:** login screen renders with a visible error banner explaining the link expired.
4. Capture: banner text, whether it's human-readable.

---

## Evidence to capture per finding

- **Severity:** HIGH (blocks journey) / MEDIUM (degraded but workable) / LOW (polish)
- **Category:** auth / routing / copy / state / network
- **Journey + step number**
- **Repro steps** (click-by-click, reproducible in 60 seconds)
- **Expected vs Actual**
- **Evidence** — at least one of: network call + status + body snippet, console error, visible text

---

## Output format

```
# Hogaan — Bug Hunt Chunk 2 Report (Auth Flows)

**Auditor:** Claude computer-use agent
**Date:** <today>
**Build:** dev localhost:3000

## 1. Executive summary
3–5 sentences. Count by severity. Top 2 to fix first.

## 2. Findings (sorted by severity)

### Finding #N — [one-line title]
- Severity:
- Category:
- Journey / step:
- Repro: 1. … 2. …
- Expected: …
- Actual: …
- Evidence: …

## 3. Things that worked
2–4 bullets.

## 4. Out-of-scope observations
One line each — do not expand.
```
