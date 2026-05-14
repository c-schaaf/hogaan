# Hogaan — Bug Hunt Chunk 4: Sessions (Regression + Depth)

## Your role

Senior QA engineer. This chunk has two jobs:
1. **Regression:** confirm that all critical fixes from Bug Hunt Chunk 1 actually hold.
2. **Depth:** probe sessions UI beyond what chunk 1 covered (search, grouping, delete gap, edge cases).

Find new bugs AND confirm old ones are gone. Do NOT fix anything.

## The product

Hogaan is a React SPA coaching companion. Local dev server: **http://localhost:3000**. Sessions are stored server-side (`GET /api/sessions` returns the list; `GET /api/sessions/:id` returns turns). Sessions with `turnCount = 0` are now server-filtered and should not appear in the list.

## Test account

- **Email:** `test@gmail.com` / **Password:** `test123`
- This account should have at least 3 past sessions with turns. If the sessions list is empty, send 3 chat turns from Home first to seed data.

## What's deliberately disabled — DO NOT FLAG

- Coaching response quality, practice tagger placeholders, stream latency — all expected.

## Scope for THIS chunk: Sessions list + transcript only

**In scope:** sessions list load, sort, grouping, search/filter, transcript loading when clicking a session, empty states, private session exclusion, delete UI.

**Out of scope:** auth flows (Chunk 2), chat streaming quality (Chunk 3), profile editing (Chunk 5), SPA routing/direct URL access (Chunk 6).

---

## Part A — Regression checks (verify chunk-1 fixes held)

Work through each check below. Record result as: **✅ FIXED** / **❌ STILL BROKEN** / **⚠️ PARTIAL**.

**R1 — Turn persistence** *(was: every session showed `0 messages`)*
1. Navigate to Sessions.
2. Do you see any session with `0 messages`? If yes, how many?
3. Send a fresh chat message from Home, wait for response, navigate back to Sessions.
4. **Expected:** the new session shows `msgs: 1`. If it still shows `0`, this is HIGH severity.

**R2 — Transcript loads on click** *(was: clicking a session showed empty chat)*
1. Click into the most recent session in the list.
2. **Expected:** user messages and bot responses visible in the transcript.
3. Click into 2 more sessions (different ages/groups). Verify each loads its transcript.
4. **Expected:** the chat header title shows the session's real title, NOT "Coaching session" (hardcoded title was also fixed).

**R3 — routeAuthed doesn't bounce you to home on refresh** *(was: F5 always went to home)*
1. Navigate to Sessions (via nav).
2. Press F5.
3. **Expected:** stay on Sessions.
4. Navigate to Profile. Press F5.
5. **Expected:** stay on Profile.

**R4 — 0-message sessions filtered** *(was: sessions with 0 turns appeared in the list)*
1. Scan the full sessions list.
2. **Expected:** no entry shows "0 messages". All visible entries have ≥ 1 message.

**R5 — Em-dash doesn't auto-submit** *(was: typing em-dash in compose triggered submit)*
1. In the Home compose box, type or paste `—` (em-dash).
2. **Expected:** em-dash appears in the input box and does NOT navigate to chat.

---

## Part B — Depth testing

### Journey B1 — Sessions list load and layout

1. Navigate to Sessions from the bottom nav.
2. Verify: sessions appear in groups ("This week" / "Earlier this month" / "Older") where applicable.
3. Within each group: are sessions ordered newest-first?
4. Do the relative-time labels look correct ("Today", "Yesterday", "3 days ago", "2 weeks ago")?
5. Is there a loading state before sessions appear? Or does it flash empty → populated?

### Journey B2 — Search / filter

1. Navigate to Sessions. Confirm there are at least 3 sessions.
2. Type a word that appears in one of the session titles (e.g., "manager", "team", "career" — whatever your test sessions were about).
3. **Expected:** filtered results, only matching titles shown.
4. Clear the search box. **Expected:** all sessions return.
5. Type a word that matches nothing: `xyzzy-no-match`.
6. **Expected:** a message like *"No sessions match 'xyzzy-no-match'."* — not a blank white area.
7. Delete all search text.
8. **Expected:** all sessions return — NOT a "No sessions yet" message on an empty query.

### Journey B3 — Private sessions excluded

1. Start a new chat from Home, toggle **Private mode ON**.
2. Send a message. Wait for response. Navigate to Sessions.
3. **Expected:** the private chat session does NOT appear.
4. Is there a note on the Sessions page explaining that private sessions aren't shown? Note what it says.

### Journey B4 — Delete UI (known gap #10 from chunk-1)

1. Hover or long-press over a session row.
2. Is there any delete, remove, archive, or "×" control?
3. **Expected finding:** no delete UI present — this is a **known gap**, not a new bug. Document: "Delete UI absent — confirmed gap #10."
4. If a delete button IS present: try clicking it, document what happens (confirm dialog? immediate delete?). Report as new (possibly positive) finding.

### Journey B5 — Open session + continue conversation

1. Click into an existing session. Verify transcript loads.
2. Add a new message in that session: *"One quick follow-up: what's the smallest step to try this week?"*
3. Send and wait for response.
4. The new turn should append to the transcript. Verify.
5. Navigate away (Home), come back to Sessions, open the same session.
6. **Expected:** the new turn is still there.

### Journey B6 — Edge: empty Sessions list

1. Is there an empty-state screen if the account has zero non-private sessions? (Hard to test with a seeded account — but if you can quickly check by filtering everything out with search, note what the zero-results copy says.)
2. Does the empty state have a CTA to start a new session?

---

## Evidence to capture per finding

- **Severity:** HIGH / MEDIUM / LOW
- **Category:** regression / sessions-list / search / routing / transcript / persist
- **Journey + step or regression item (R1–R5)**
- **Repro** (click-by-click in 60 seconds)
- **Expected vs Actual**
- **Evidence:** network call, console error, or screen state description

---

## Output format

```
# Hogaan — Bug Hunt Chunk 4 Report (Sessions Regression + Depth)

**Auditor:** Claude computer-use agent
**Date:** <today>
**Build:** dev localhost:3000

## 1. Executive summary

## 2. Regression checklist

| Item | Status |
|---|---|
| R1 Turn persistence (msgs > 0) | ✅ FIXED / ❌ BROKEN / ⚠️ PARTIAL |
| R2 Transcript loads on click | ✅ FIXED / ❌ BROKEN / ⚠️ PARTIAL |
| R3 routeAuthed refresh stays on page | ✅ FIXED / ❌ BROKEN / ⚠️ PARTIAL |
| R4 0-message sessions filtered | ✅ FIXED / ❌ BROKEN / ⚠️ PARTIAL |
| R5 Em-dash no auto-submit | ✅ FIXED / ❌ BROKEN / ⚠️ PARTIAL |

## 3. New findings (sorted by severity)

### Finding #N — [title]
- Severity:
- Category:
- Journey / step:
- Repro:
- Expected:
- Actual:
- Evidence:

## 4. Known gaps confirmed

- Delete UI: absent / present (describe)
- Private session exclusion: behaviour described

## 5. Things that worked

## 6. Out-of-scope observations (one line each)
```
