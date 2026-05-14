# Hogaan — Bug Hunt Chunk 3: Chat + Coaching Core

## Your role

Senior QA engineer doing exploratory testing. Find and document bugs — do NOT fix anything.

You understand SSE streaming: a `POST /api/chat/turn/stream` call keeps the connection open, emitting `event: delta` lines until `event: end`. Each turn should be persisted server-side (turns table, +1 on session turnCount).

## The product

Hogaan is a React SPA coaching companion. Local dev server: **http://localhost:3000**. The chat path: Home compose box → Shell sets chatSeed + phase='chat' → Chat.tsx POSTs to /api/chat/turn/stream → streams delta events → on `end`, a turn row is persisted and the session's turnCount is bumped.

## Test account

- **Email:** `test@gmail.com` / **Password:** `test123` (fully onboarded)

## What's deliberately disabled — DO NOT FLAG

- Coaching response quality (tone, question count) — separate audit
- Practice tagger writes placeholders `integrity / self / 0` — expected
- Streaming takes 1–2s before first token — expected
- `tagger_confidence: 0` on every turn — expected while tagger is disabled

## Scope for THIS chunk: Chat interaction only

**In scope:** compose box, SSE stream, turn persistence, multi-turn context, private mode, crisis card, session title generation, compose box keyboard UX.

**Out of scope:** sessions list UI (Chunk 4), profile editing (Chunk 5), SPA routing/refresh (Chunk 6), auth flows (Chunk 2).

---

## Journeys

### Journey 1 — Single turn: compose → stream → persist

1. Sign in. Land on Home.
2. Type in the compose box: *"My manager keeps interrupting me in meetings — what's my first move?"*
3. Press Enter or click the arrow button.
4. **Observe the stream:**
   - Does a spinner appear before the first token?
   - Does text stream visibly?
   - Does it complete without cutting off?
5. After the response ends, note the chat header title (should update from "Tonight's session" to a generated title within a few seconds).
6. Navigate to Sessions. **Verify:** the session appears in the list with `msgs: 1` (not `0 messages`). This is the key regression test for the turn-persistence fix.
7. **Capture:** if msgs shows 0, this is HIGH severity — report it.

### Journey 2 — Multi-turn context carry

Start a **fresh chat** (go back to Home, use the compose box again — this creates a new session).

1. **Turn 1:** *"I lead a team of 5 engineers. My biggest challenge is decision fatigue — I'm making every call myself."*
2. Wait for response. Read it — does it engage with the "decision fatigue / making every call" framing?
3. **Turn 2:** *"What's the first practice that addresses this?"*
4. Wait for response. **Key signal:** does the response know it's about YOUR team delegation problem, or does it start fresh as if Turn 1 never happened?
5. **Turn 3:** *"Can you give me a concrete script for tomorrow's standup?"*
6. Does Turn 3 reference the context from Turns 1–2, or is it generic?
7. **Verdict:** rate context carry as FULL / PARTIAL (last turn only) / NONE (each turn is isolated).
8. If NONE: this is a HIGH severity regression — the multi-turn messages array may not be wiring prior turns correctly.

### Journey 3 — Private mode

1. Start a fresh chat from Home.
2. In the Chat screen, toggle **Private mode ON** (look for a lock or moon icon, usually in the chat header).
3. Verify a visual indicator appears (banner, header colour change, etc.).
4. Send: *"Private test — should not be saved."*
5. Wait for response.
6. Navigate to Sessions. **Expected:** this session does NOT appear in the list.
7. Come back to Chat (back button or nav). **Expected:** private session is still visible in the current tab.
8. **Refresh the page.** **Expected:** private chat is gone (it was never saved — this is correct behaviour, not a bug).

### Journey 4 — Crisis detection

> These are test inputs for QA purposes only.

1. Fresh chat from Home.
2. Type — **but do not send yet** — *"I've been having thoughts of hurting myself because work stress is overwhelming"*
3. Is there any live preview of crisis UI while typing? (Not expected — just observe.)
4. **Send** the message.
5. **Expected (immediate, before stream):** client-side crisis card appears instantly — not waiting for the server. The card should show crisis resources (phone number, text line).
6. **Expected (streaming):** the server's response should be a safe/supportive message, NOT a coaching response about work stress.
7. After the crisis card: can you dismiss it and send a normal message? Does the session continue?
8. **Capture:** timing of crisis card (before first stream token? after?), resources shown, whether normal chat resumes.

### Journey 5 — Session title generation

1. Fresh chat. Send: *"I need help thinking through whether to leave my job — I'm at a crossroads."*
2. Wait for response. **Immediately** look at the chat header title. Is it still "Tonight's session" or has a title generated?
3. Send a second turn: *"What's the biggest regret people have when they stay too long?"*
4. Wait. Check the title again in the sidebar rail (desktop) or by navigating to Sessions.
5. **Expected:** within 1–2 turns, a descriptive title like "Career crossroads" or "Deciding whether to leave" appears.
6. **If still "Untitled session" after 2 turns:** check the network tab — was `GET /api/sessions/:id` or a title-generation endpoint called? Report if title never generates.

### Journey 6 — Compose box keyboard UX

1. From Home compose box:
   a. Type text. Press **Shift+Enter**. **Expected:** newline inserted, NOT submitted.
   b. Type text with an **em-dash** (`—` — on Mac press ⌥⇧-, on Windows Alt+0151 on numpad, or paste). **Expected:** em-dash appears in box, NOT submitted.
   c. Type text. Press **Enter** (no modifiers). **Expected:** navigates to chat and submits.
2. From Chat compose box (textarea):
   a. Type text. Press **Shift+Enter**. Note whether a newline is inserted or it submits.
   b. Type text with an em-dash. **Expected:** em-dash inserted, NOT submitted.
   c. Press **Enter** (no modifiers). **Expected:** sends the message.
3. **Capture any auto-submit on non-Enter keys.**

### Journey 7 — Continue an existing session

1. Navigate to Sessions. Click into a session that already has at least 2 turns.
2. Verify the transcript loads (past user + bot messages visible).
3. **Add a new turn:** type *"Following up — what would you say is the one thing I should try first?"* and send.
4. Verify it streams and appends to the existing transcript.
5. Navigate to Sessions again. Open the same session.
6. **Expected:** all turns including the new one are present.

---

## Evidence to capture per finding

- **Severity:** HIGH / MEDIUM / LOW
- **Category:** stream / persist / context / crisis / private-mode / keyboard-ux / title
- **Journey + step**
- **Repro** (60-second reproducible steps)
- **Expected vs Actual**
- **Evidence:** network tab (request + SSE events), console errors, visible screen

---

## Output format

```
# Hogaan — Bug Hunt Chunk 3 Report (Chat Core)

**Auditor:** Claude computer-use agent
**Date:** <today>
**Build:** dev localhost:3000

## 1. Executive summary

## 2. Findings (sorted by severity)

### Finding #N — [title]
- Severity:
- Category:
- Journey / step:
- Repro:
- Expected:
- Actual:
- Evidence:

## 3. Context carry verdict
Rate as FULL / PARTIAL / NONE and explain in 2–3 sentences.

## 4. Things that worked

## 5. Out-of-scope observations (one line each)
```
