# Hogaan — Bug Hunt Chunk 6: Routing + Navigation

## Your role

Senior QA engineer. This chunk verifies all navigation patterns across the full app: phase transitions, SPA fallback, browser refresh on every phase, browser back button, deep links from the address bar.

You are the **regression guard** for this sprint — your primary job is confirming that the fixes from this sprint (Findings #1–#11 from chunk 1, plus sprint 1–3 code changes) all hold. Secondary job: find any NEW routing bugs not covered in chunk 1.

## The product

Hogaan is a React SPA with internal phase-state routing (NO URL router — `Shell.tsx` manages a `phase` state variable). Phases: `login / signup / verify / forgot / reset / onboarding / home / chat / sessions / profile`. The server's `@fastify/static` plugin handles SPA fallback (direct URL access → serves `index.html` → React takes over).

Key fix shipped: `decorateReply: true` so direct-URL access no longer returns `{"error":"static_not_registered"}`. Also: `sessionStorage` now persists the last authed phase so `routeAuthed()` can restore it instead of always going to home.

## Test account

- **Email:** `test@gmail.com` / **Password:** `test123` (fully onboarded)

## What's deliberately disabled — DO NOT FLAG

- Coaching quality, tagger, stream latency — all expected.

## Scope for THIS chunk: Navigation and routing only

**In scope:** phase transitions (nav clicks, onBack, onOpen), browser refresh on every phase, browser back button, direct URL access (deep links), SPA fallback, `routeAuthed()` phase restore, auth-state routing edge cases.

**Out of scope:** chat content quality (Chunk 3), sessions data/transcripts (Chunk 4), profile field editing (Chunk 5), auth credential errors (Chunk 2).

---

## Part A — Core routing regression

**R1 — SPA fallback: direct URL access no longer returns JSON error**

*(Was: typing `/sessions` in address bar returned `{"error":"static_not_registered"}`)*

1. While signed in, type `http://localhost:3000/sessions` directly in the address bar. Press Enter.
2. **Expected:** the SPA loads — you see the Sessions phase (or the app boots and routes you to Sessions). NOT a JSON error, NOT a blank page.
3. Type `http://localhost:3000/profile`. Press Enter.
4. **Expected:** SPA loads, Profile phase renders.
5. Type `http://localhost:3000/anything-unknown`. Press Enter.
6. **Expected:** SPA loads (index.html served, app boots), you end up on a known phase (probably login or home).
7. Type `http://localhost:3000/api/profile`. Press Enter.
8. **Expected:** you get the JSON API response (401 if not signed in) — NOT index.html.

**R2 — routeAuthed phase restore: F5 stays on current phase**

*(Was: any browser refresh or auth event bounced the user to home)*

1. Sign in. Navigate to Sessions.
2. Press **F5**.
3. **Expected:** stay on Sessions. Record actual outcome.
4. Navigate to Profile. Press F5.
5. **Expected:** stay on Profile.
6. Open a past session (Chat). Press F5.
7. **Expected:** stay in Chat (transcript may or may not reload — that's a separate concern — but you should NOT be on Home).

**R3 — TOKEN_REFRESH doesn't reroute to home**

*(Auth events INITIAL_SESSION + TOKEN_REFRESH were both triggering routeAuthed, causing home bounce)*

1. Sign in. Navigate to Profile.
2. Open DevTools → Network. Watch for `/api/profile` calls.
3. Wait 1–2 minutes on Profile without interacting (or simulate by clearing Supabase token and re-navigating — skip if too involved).
4. **Expected:** any background token refresh should NOT bounce you back to home.
5. Document what you observe. If /api/profile is called multiple times on cold load, note the count.

---

## Part B — Full navigation sweep

Walk every phase transition systematically. For each: note if it works, partially works, or is broken.

### B1 — Unauthenticated phases

1. Sign out (Profile → Sign out).
2. Verify you land on Login.
3. Click "Forgot password". Verify you land on the Forgot phase.
4. Click back/cancel. Verify you return to Login (not stuck).
5. Click "Create account" (or signup link). Verify Signup phase renders.
6. Click back/cancel. Verify you return to Login.

### B2 — Login → Home

1. Sign in. Verify Home renders.
2. Press browser **Back button**.
3. **Expected:** you do NOT go back to "Login with the session still loaded" — behavior depends on implementation. Document what happens.

### B3 — Home → Chat → Back

1. From Home, click the compose box or a suggestion chip to start a chat.
2. Verify Chat renders.
3. Click the **back arrow** in Chat.
4. **Expected:** return to Home.
5. **F5 from Chat**: verify you stay in Chat, not redirected to Home.

### B4 — Home → Sessions → open session → Back

1. From Home, click Sessions in the nav.
2. Verify Sessions list renders.
3. Click into a session. Verify transcript renders.
4. Click the **back arrow** in Chat.
5. **Expected:** return to Sessions (or Home — document which).
6. **F5 from Sessions**: verify you stay on Sessions.

### B5 — Home → Profile → Back

1. From Home, click Profile in the nav.
2. Click the **back arrow** (if one exists in Profile).
3. **Expected:** return to Home (or whichever screen makes sense).
4. **F5 from Profile**: verify you stay on Profile.

### B6 — Nav between authed phases

1. Sign in. Start on Home.
2. Click Sessions in the bottom nav. Verify Sessions renders.
3. Click Profile in the bottom nav. Verify Profile renders.
4. Click the home-equivalent nav item. Verify Home renders.
5. Verify the active nav indicator updates correctly on each transition.

### B7 — Onboarding (new-user path) — skip if not easily testable

1. (Only attempt if you can reach the onboarding phase without creating a new account — e.g., if there's a dev shortcut.) 
2. If you can reach onboarding: verify the practice-selection steps flow through and land on Home after completion.
3. If you cannot reach it without signing up a new account: **skip this journey and note it**.

---

## Part C — Adversarial navigation

### C1 — Back button after sign-out

1. Sign in. Navigate to Profile.
2. Sign out. You land on Login.
3. Press browser **Back button** multiple times.
4. **Expected:** you do NOT navigate back to an authed phase with real user data showing.
5. **If you can see Profile or Home content while signed out:** HIGH severity.

### C2 — Direct API access while unauthenticated

1. While NOT signed in:
   - Open DevTools Console.
   - `fetch('/api/sessions').then(r => console.log(r.status))` → Expected: 401.
   - `fetch('/api/profile').then(r => console.log(r.status))` → Expected: 401.
2. Verify these return 401, not 200 or 500.

---

## Evidence to capture per finding

- **Severity:** HIGH / MEDIUM / LOW
- **Category:** routing / auth / spa-fallback / nav-state / back-button
- **Journey + step (or regression item R1–R3)**
- **Repro** (click-by-click in 60 seconds)
- **Expected vs Actual**
- **Evidence:** URL bar content, network call + status, screen visible, console errors

---

## Output format

```
# Hogaan — Bug Hunt Chunk 6 Report (Routing + Navigation)

**Auditor:** Claude computer-use agent
**Date:** <today>
**Build:** dev localhost:3000

## 1. Executive summary

## 2. Regression checklist

| Item | Status |
|---|---|
| R1 SPA fallback (direct URL) | ✅ FIXED / ❌ BROKEN / ⚠️ PARTIAL |
| R2 F5 stays on current phase | ✅ FIXED / ❌ BROKEN / ⚠️ PARTIAL |
| R3 Token refresh no home bounce | ✅ FIXED / ❌ BROKEN / ⚠️ PARTIAL |

## 3. Navigation sweep results

| Journey | Result | Notes |
|---|---|---|
| B1 Unauthed phases | PASS / FAIL / PARTIAL | |
| B2 Login → Home → back | PASS / FAIL / PARTIAL | |
| B3 Home → Chat → back | PASS / FAIL / PARTIAL | |
| B4 Home → Sessions → session → back | PASS / FAIL / PARTIAL | |
| B5 Home → Profile → back | PASS / FAIL / PARTIAL | |
| B6 Nav between authed phases | PASS / FAIL / PARTIAL | |
| C1 Back after sign-out | PASS / FAIL | |
| C2 API access while unauthed | PASS / FAIL | |

## 4. New findings (sorted by severity)

### Finding #N — [title]
- Severity:
- Category:
- Journey / step:
- Repro:
- Expected:
- Actual:
- Evidence:

## 5. Things that worked

## 6. Out-of-scope observations (one line each)
```
