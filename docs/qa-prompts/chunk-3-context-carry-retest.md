# Hogaan — Context-Carry Re-test (Chunk 3)

## Why this run exists

Chunk-2 found that the prompt tune helped opener turns but the bot LOST CONTEXT on T2/T3 across scenarios — to the point of asking "Who is he?" about a mentor whose identity had just been established. The root cause turned out to be structural, not voice:

The streaming endpoint was packing prior turns into the **system prompt** as flattened text, but the Anthropic API only treats the `messages` array as real conversation. So the bot saw past turns as background instructions, not as the conversation it was in. When pressed for a draft in R2 T2, it hallucinated "I'm coming in mid-conversation and I don't know who 'him' is" — literally true from its conversation-tracking perspective.

The streaming endpoint has been changed: prior turns are now passed as proper `messages` (`role: 'user'` / `role: 'assistant'`) in addition to the system prompt. The same v2_unified_tune1 prompt is still in effect.

Your job: run a tight 4-scenario re-test of the scenarios where context loss was the failure, plus one explicit probe for the canonical S5 gold-standard regression.

## Setup

- App: **http://localhost:3000**
- Login: `test@gmail.com` / `test123`
- Each scenario: fresh session.
- **Important:** if you tested very recently, refresh the page once to make sure the dev server has reloaded the streaming route code.

## Scenarios — 4 total, 3 turns each

**C1 — Mentor grief, context-carry across 3 turns** (was R4/S10)
- T1: *"My mentor passed away last month. I keep wanting to call him when something happens at work. I don't know how to lead without him in my corner."*
- T2: *"He asked one question that cut through. Last week I had to fire someone and sat in my car wishing I could ask him."*
- T3: *"He'd ask 'are you firing them because you have to or because it's easier than coaching them?'"*

**Pass condition:** T2 and T3 retain the mentor identity (no "Who is he?"). T3 honors past tense — does NOT treat the firing as still-open.

**C2 — Cultural specificity across 3 turns** (was R5/S5 — the gold standard)
- T1: *"I'm Somali and my parents want me to take a stable government job. I want to start a company. They sacrificed everything for me to be safe and I feel guilty wanting more."*
- T2: *"Autonomy and community. Dad says 'we didn't come here for you to gamble.'"*
- T3: *"His brother failed in business in Mogadishu. This isn't 1990 Somalia."*

**Pass condition:** T3 lands something at the caliber of "ghosts don't read calendars" — a real take with Somali / parental / generational specificity. Does NOT collapse to "maybe a parent or someone close to you is holding a fear" generic.

**C3 — Draft-on-request pressure test** (was R2/S8 — canonical refusal)
- T1: *"I'm dealing with a hard conversation with my team lead tomorrow. He keeps assigning me work that's not in my role and I'm scared to push back because he controls my promotion."*
- T2: *"That's not helpful. You're just asking me questions. Just tell me what to say to him."*

**Pass condition:** T2 gives an actual 1–3 line draft / opening sentence the user can react to. **Must NOT** say "I'm coming in mid-conversation" or "I don't know who 'him' is" — that phrasing now constitutes a flat fail (it indicates the bot pretended ignorance to dodge).

**C4 — Celebration energy match** (was R3/S9 — separate from context-carry; checking if §6's edits handled this)
- T1: *"I just closed my first 6-figure deal. I'm so happy I want to cry."*
- T2: *"Not a fluke. Want to take my team out tonight."*

**Pass condition:** T1 spends a full beat on the joy itself. Does NOT pivot to "what does this mean beyond the number" or similar meaning-making in the same bubble. The pivot, if any, comes on T2 or later — not stacked into the celebration response.

## Scoring (compact)

For each turn, capture inline:

- Verbatim bot response (or condensed to 15 words if long)
- Flags only (no full 5-axis rubric this run): `forgot`, `refused-draft`, `mid-conv-alibi` (new — said "I'm coming in mid-conversation" or similar), `menu`, `>1q`, `mismatch-energy`, `cliché`, `collapse` (lost specificity)
- One-line note per turn

Per-scenario **verdict**: PASS / PARTIAL / FAIL against the pass condition.

## Report format

```
# Hogaan — Context-Carry Re-test (Chunk 3)

## Top-line: did the structural fix work?
2–3 sentences. Did the bot stop losing context on T2/T3? Did the S8 dodge survive?

## Comparison

| Scenario | Chunk-2 verdict | Chunk-3 verdict | Key diff |
|---|---|---|---|
| C1 (mentor grief) | FAIL | ... | ... |
| C2 (Somali/parents) | FAIL | ... | ... |
| C3 (draft refusal) | FAIL | ... | ... |
| C4 (celebration) | PARTIAL/FAIL | ... | ... |

## Per-scenario log (terse — verbatim quote + flags + one-line note per turn)

### C1
- T1 bot (15 words): "..."
- Flags: ...
- T2 ...
- T3 ...
- Verdict: PASS / PARTIAL / FAIL

(... same for C2, C3, C4)

## Standout
- 2-3 verbatim quotes — best and worst.

## Recommendation
Ship the structural fix as-is / tune further / different fix needed. One sentence why.
```

## Guardrails

- 4 scenarios × 3 turns (C1, C2 are 3 turns; C3, C4 are 2 turns) = ~10 chat turns. Should fit very easily.
- One account. Don't sign out.
- Don't take screenshots mid-stream.
- Don't bug-hunt UI.
- Don't introduce new scenarios.
