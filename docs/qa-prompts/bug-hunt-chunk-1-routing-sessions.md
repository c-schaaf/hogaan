# Hogaan — Bug Hunt Chunk 1: Routing + Sessions

## Your role

Senior QA engineer / SRE doing exploratory testing on a working web app. You find and document bugs — you do NOT fix anything. Produce a developer-ready report another engineer can work from cold.

You know to check the network tab. You know that "weird redirect" usually means stale closure or unhandled API error. You suspect state races between auth callbacks and route guards.

## The product

Hogaan is a web-based leadership-coaching companion. Local dev server: **http://localhost:3000** (already loaded in your side panel tab). Backend: Fastify. Auth: Supabase Auth (browser-side). Every `/api/*` call validates `Authorization: Bearer <token>`.

App is a React SPA: `Shell.tsx` orchestrates phases (login / signup / verify / forgot / reset / onboarding / home / chat / sessions / profile). Chat uses SSE streaming via `POST /api/chat/turn/stream`.

## Login

- Email: `test@gmail.com`
- Password: `test123`

This account has already completed onboarding. Use it throughout. **Do not sign up a new account.**

## What's deliberately disabled — DO NOT FLAG

- LLM triage classifier, post-response safety gate (Check 8), and other QC graders
- Practice/level tagger writes placeholders `integrity / self / 0` on every turn
- Voice register feels "therapist-y" or asks questions — that's a separate audit, not a bug
- Streaming takes ~1–2s to start its first token

## What you SHOULD focus on in THIS chunk

This run is **Routing + Sessions** only. Chat content quality, profile editing, sign-out, mobile responsive — all in a separate chunk. If you encounter bugs in those areas during your walk, note them in a short "out-of-scope observations" section at the end but don't dive in.

The user has reported two known symptoms — your job is to confirm or refute these AND find others in the same area:

1. **"Redirect to homepage for no reason"** — sometimes a route action lands them at home unexpectedly
2. **"Click a session in history, no transcript appears"** — session list works, but tapping into a past session shows nothing

Additionally, an engineering hypothesis to test: **the server may be silently stitching what users intend as separate conversations into one session.** This is independent of the two known bugs. See Journey 3 below for how to probe it.

## Journeys to walk

### Journey 1 — Login + home landing (quick warmup)

1. From the login screen, sign in with the credentials above.
2. Verify `/home` renders: greeting, compose box, suggestion chips, sidebar (desktop) / bottom nav (mobile).
3. **Refresh the page while on /home.** Verify you stay on home — not bounced to login or signup.
4. Note the time-to-render after clicking "Sign in" (rough — "instant" / "<1s" / ">1s" / ">3s").

### Journey 3 — Sessions history (the known bug zone + session-conflation probe)

This is the high-signal journey for this chunk. Walk it carefully.

**3a. Baseline the sessions list.**
1. From `/home`, navigate to Sessions.
2. Count: how many past sessions are shown? Are they grouped (Today / Earlier / by week)?
3. **Sessions list shows a "Private sessions aren't shown here" indicator** — if you see it, note it. From a prior audit, "most created sessions never appeared in the list" was reported — verify whether this matches what you see.

**3b. Open a past session — REPRO the known bug.**
1. Click into the most recent past session that's not the current/active one.
2. Verify the transcript loads with both user and bot turns.
3. If the transcript does NOT load (empty screen, spinner forever, "no turns yet"), capture: the URL after click, the `/api/sessions/:id` network call status and response body, and any console errors.
4. Try clicking 2–3 different past sessions in different orders. Document each.

**3c. Session-conflation probe — IMPORTANT.**
This is the new hypothesis. Walk it deliberately:
1. From `/home`, click the compose box and send: *"Test scenario A — what's my first move on a hard performance review tomorrow?"*
2. Wait for the response to fully stream.
3. **Navigate back to `/home`** (not new chat — just home).
4. Click the compose box again and send: *"Test scenario B — completely different topic, I'm thinking of leaving my job."*
5. Wait for the response.
6. Navigate to Sessions list.
7. **Capture:** how many NEW session entries appeared? If only ONE new entry contains both scenario A and B as turns, that's the session-conflation bug — the server stitched what looked like two separate conversations into one.
8. As a confirmation, click into that session and verify it has BOTH messages from scenario A AND scenario B in one transcript.

**3d. Delete a session (carefully).**
1. If there's a delete button on a session, try deleting an OLD test session (not the active one, not the conflation-probe one from 3c).
2. Verify it deletes and the list refreshes.

### Journey 6 — Cross-screen navigation + deep refresh (the routing bug zone)

This is where "redirect to homepage for no reason" is most likely to surface.

1. From `/home`, click into Sessions. **Refresh the browser.** Verify you stay on Sessions (don't get bounced to /home or /login).
2. From Sessions, click into a past session (Chat). **Refresh.** Verify you stay in that session's chat with full transcript visible.
3. From Chat, click Profile. **Refresh.** Verify you stay on Profile.
4. Use the browser back button after each refresh. Verify intuitive history.
5. **If at any point you get bounced to `/home` unexpectedly:**
   - Capture the network tab — what was the last `/api/profile` response? Did it 401? Return malformed JSON? Take >2s?
   - Capture any console errors.
   - Note the EXACT click sequence that triggered it.
6. Try direct-URL probes: type `/sessions` and `/profile` into the address bar with a fresh page load. Note where you actually end up.

### Adversarial probe — Logged-out URL access

(Save Journey 5's full sign-out for the next chunk — but do this quick probe now since it's routing-adjacent.)

1. From an authenticated state, open a new tab.
2. Type `/api/profile` into the URL bar directly. Note the response (expected: 401, NOT 200 or 500).
3. Type `/api/sessions` directly. Note the response.
4. Close the new tab. Return to your primary tab. Verify your session is still intact (no surprise sign-out).

## Evidence to capture per finding

- **Severity**: HIGH / MEDIUM / LOW (HIGH blocks a journey, MEDIUM degraded but workable, LOW polish)
- **Category**: routing / state / data-fetch / auth / copy
- **Which journey + step number**
- **Repro steps**: click-by-click. Another engineer must reproduce in 60 seconds.
- **Expected** vs **Actual**
- **Evidence — at least one of:**
  - Network: failed request URL + status + brief response body (`GET /api/sessions/abc → 200, body: {"turns":[]}`)
  - Console: first 3 lines of any error
  - Description of what's visible on screen (screenshot text)
- **Suspected file** (if you can guess) — e.g., `Shell.tsx routeAuthed`, `Sessions.tsx onOpen`. These are hints. Verify before trusting.

## Suspected-file hints (use as starting points, not gospel)

- "Click past session, no transcript" → `web/src/phases/Chat.tsx`'s props don't currently accept a session id; Sessions list's `onOpen` may not be passing one.
- "Redirect to homepage" → `web/src/Shell.tsx`'s `routeAuthed()` function or its dependent useEffect; check whether `/api/profile` is returning anything weird (401 transient, slow, etc.).
- Session conflation (3c) → server-side `resolveSession` in `src/session-lifecycle/resolver.ts` ignores client session intent and reuses any open session within 30 min.

## Output format — Markdown report

```
# Hogaan — Bug Hunt Chunk 1 Report (Routing + Sessions)

**Auditor:** Claude computer-use agent
**Date:** <today>
**Build:** dev server localhost:3000

## 1. Executive summary
3–5 sentences. Total findings count by severity. Top 2–3 to fix first.

## 2. Reproduction of known + suspected bugs
- [ ] "Redirect to homepage for no reason" — REPRODUCED / NOT REPRODUCED (+ details)
- [ ] "Click session, no transcript" — REPRODUCED / NOT REPRODUCED (+ details)
- [ ] Session conflation (scenarios A and B in one session) — CONFIRMED / NOT CONFIRMED (+ details)

## 3. Findings (sorted by severity)

### Finding #1 — [one-line title]
- Severity: HIGH / MEDIUM / LOW
- Category: routing / state / data-fetch / auth / copy
- Journey: N, step M
- Repro: 1. ... 2. ...
- Expected: ...
- Actual: ...
- Evidence:
  - Network: ...
  - Console: ...
  - Screenshot: ...
- Suspected file: ...

(Repeat for every finding.)

## 4. Things that worked
- 2–4 bullets — e.g., "refresh on /sessions stayed on /sessions"

## 5. Out-of-scope observations (chat quality, profile, signout, mobile)
Brief — one line each. Don't dive in.

## 6. Blocked / couldn't test
Anything you tried but couldn't get to.
```

## Guardrails

- Use only `test@gmail.com`. Do NOT sign up a new account.
- Do NOT delete the test account.
- Do NOT delete the conflation-probe session (3c) — engineers may want to inspect it.
- Don't fix anything — you report, engineer fixes.
- Don't blast crisis content (separate audit).
- Stop after Journey 6 + the logged-out URL probe. Don't drift into chat-quality territory.

Begin with Journey 1.
