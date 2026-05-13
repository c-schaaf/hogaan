# Hogaan — Coaching Quality Re-test (Chunk 2)

## Why this run exists

Chunk 1 found three repeating failure modes. The system prompt has been tuned to target each one:

1. **Reflexive question-ending (27/30 last time)** — §5 was rewritten to permit and encourage landing a take and stopping. Roughly half of turns should now NOT end with a question.
2. **Stacked + multi-option questions (18/30 last time)** — §6 now explicitly bans "is it X, Y, or Z?" menus and tells the model to pick one question if it has two.
3. **Refused to give a draft when asked (S8 canonical failure)** — §2 and §6 now require giving a 1–3 line draft on request; defending the method is named as "the failure mode this product is most allergic to."

Also added: a context-carry preamble to §5, plus two new few-shot examples (Ex 5 draft-on-request, Ex 6 land-a-take).

Your job: re-run six scenarios — five were the worst offenders last time, two are new and probe for **overcorrection** (the risk that the bot now never asks questions, or gives drafts when it shouldn't, or pushes too hard on someone who needs warmth).

## Setup (same as before)

- App: **http://localhost:3000** (already open in your side panel)
- Login: `test@gmail.com` / `test123`
- Each scenario: a fresh session (return to /home, send the opener fresh).

## Scenarios — 6 total, 3 turns each

**R1 — Was S4 (worst stacking last time)**
Opener: *"I have two job offers. One pays 40% more but the team seems toxic. The other is meaningful but the salary stays flat. I have to decide by Friday."*
**Pass condition:** Turn 1 acknowledges the Friday pressure and does NOT stack 3 things in one bubble. Either lands a take, OR asks ONE single-pointed question — not a menu.

**R2 — Was S8 (canonical draft-refusal)**
Opener: S1's opener: *"I'm dealing with a hard conversation with my team lead tomorrow. He keeps assigning me work that's not in my role and I'm scared to push back because he controls my promotion."*
Turn 2 (always, regardless of T1 response): *"That's not helpful. You're just asking me questions. Just tell me what to say to him."*
**Pass condition:** Turn 2 gives an actual 1–3 line draft / opening line / words the user can react to. NOT a defense of the method.

**R3 — Was S9 (energy mismatch on celebration)**
Opener: *"I just closed my first 6-figure deal. I'm so happy I want to cry."*
**Pass condition:** Turn 1 spends a full beat on the joy itself before pivoting to meaning-making. No "what does it mean beyond the number" in the same bubble as the celebration.

**R4 — Was S10 (context drift on grief)**
Opener: *"My mentor passed away last month. I keep wanting to call him when something happens at work. I don't know how to lead without him in my corner."*
Turn 2: *"He asked one question that cut through. Last week I had to fire someone and sat in my car wishing I could ask him."*
Turn 3: *"He'd ask 'are you firing them because you have to or because it's easier than coaching them?'"*
**Pass condition:** Turn 3 does NOT treat the firing as still-open. Past tense is honored. Mentor identity is not lost.

**R5 — Was S5 (gold standard — should still be gold)**
Opener: *"I'm Somali and my parents want me to take a stable government job. I want to start a company. They sacrificed everything for me to be safe and I feel guilty wanting more."*
Turn 2 (verbatim): *"Autonomy and community. Dad says 'we didn't come here for you to gamble.'"*
Turn 3 (verbatim): *"His brother failed in business in Mogadishu. This isn't 1990 Somalia."*
**Pass condition:** Turn 3 lands something at the caliber of "ghosts don't read calendars" — a real take with cultural specificity. If it's dropped to bland reflection, we've overcorrected.

**R6 — NEW: overcorrection probe (vague opener that NEEDS a clarifying question)**
Opener: *"Something happened at work today and I can't stop thinking about it."*
**Pass condition:** Turn 1 asks ONE focused clarifying question — does NOT reflexively give a take based on zero information. The prompt edits permit landing-and-stopping; they should not have killed the bot's instinct to ask when it genuinely doesn't know enough.

## Scoring (same rubric, abbreviated)

For each turn, capture inline:

- Score line: `real-person N / one-move N / got-me N / push N / length N`
- Flags (if any): `cliché`, `>1q`, `menu`, `forgot`, `refused-draft`, `false-crisis`, `over-take` (new — gave a take when a question was needed), `mismatch-energy`
- One-line note

And for each scenario, a **verdict line**: PASS / PARTIAL / FAIL against the pass condition above.

## Report format

```
# Hogaan — Coaching Quality Re-test (Chunk 2)

## Top-line: did the tune work?
3–4 sentences. Did the three failure modes improve? Did anything get worse (overcorrection)?

## Comparison table

| Scenario | Old verdict (Chunk 1) | New verdict | What changed |
|---|---|---|---|
| R1 (was S4) | stacked 3 things, ignored Friday | PASS / PARTIAL / FAIL | ... |
| R2 (was S8) | refused to draft | PASS / PARTIAL / FAIL | ... |
| R3 (was S9) | pivoted off joy in 2 beats | PASS / PARTIAL / FAIL | ... |
| R4 (was S10) | lost past tense + mentor identity | PASS / PARTIAL / FAIL | ... |
| R5 (was S5) | "ghosts don't read calendars" | PASS / PARTIAL / FAIL | ... |
| R6 (new) | — | PASS / PARTIAL / FAIL | ... |

## Per-scenario log
(Same shape as Chunk 1 — terse, one line per turn, scores + flags + note.)

## Pattern delta
What systematically improved. What systematically got worse. Quote any standout new lines (good or bad).

## Recommendation
Ship the tune as-is / tune further / partial rollback. One sentence why.
```

## Guardrails

- 6 scenarios × 3 turns = 18 chat turns total. Should fit comfortably in context.
- One account, multiple sessions. Don't sign out.
- Don't take screenshots mid-stream — wait for the response to settle.
- Don't bug-hunt — quality re-test only.
- Don't introduce new scenarios beyond R1–R6.
