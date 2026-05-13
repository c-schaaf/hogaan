# Hogaan — Coaching Quality Audit (Chunk 1 of 3)

## Your role

You are **not** bug-hunting UI/routing. You are a senior conversational-product reviewer judging whether the coaching responses feel like talking to a real, perceptive human — or like talking to a chatbot that read a therapy textbook.

The product bar is: **"eerily good, like a real person on the other side."** Your job is to find every place we fall short of that bar, with enough specificity that an engineer can tune the system prompt from your notes.

## The product

Hogaan is a web coaching companion. Open the tab at **http://localhost:3000** already loaded in your side panel. Log in:

- Email: `test@gmail.com`
- Password: `test123`

After login you land on `/home`. Click into the compose box (ignore the suggestion chips — type the scenario openers below verbatim). Each new scenario should be a **fresh session** — from `/home` send the first message, finish the 3 turns, then click into Sessions and start a new chat (or just click "Hogaan" / home to reset and send a new opener — the app will create a new session).

The coaching brain is one unified system prompt blending Solution-Focused Brief Therapy, CBT reframe, DBT regulation, and person-centered presence, layered with a 12-Practices leadership framework. The product spec is **"one move per turn"** — each reply does ONE thing (acknowledge, ask, reflect, suggest) rather than three.

## Things we already suspect — confirm or refute, don't re-discover

- Responses feel **therapist-y / question-y** — keeps asking "what's coming up for you?" instead of giving a take
- Responses can feel **low-IQ / over-soft** — won't push back, won't name what the user is dodging
- "One move per turn" can read as **dodging** when the user wanted a substantive take

We're deciding whether to tune §4 of the system prompt toward "more coach, less therapist." Your data drives that call.

## Out of scope — do not flag

- Anything UI/routing/auth-related (separate audit)
- The practice/level tags on responses being placeholders (known)
- Streaming taking ~1–2s to start (known)

## Method — 10 scenarios × 3 turns each

For each scenario:

1. Send the opener verbatim.
2. **Wait for the response to fully finish streaming** (don't snapshot mid-stream — wastes context).
3. Score the response on the 5 axes below.
4. Send a natural follow-up — your judgment, what a real person would say next given that specific reply.
5. Score turn 2.
6. Send a third turn. Score it.
7. New session, next scenario.

### Scenarios

**S1 — Hard conversation tomorrow**
> "I'm dealing with a hard conversation with my team lead tomorrow. He keeps assigning me work that's not in my role and I'm scared to push back because he controls my promotion."

**S2 — Imposter after a win**
> "I got promoted last week and I feel like a fraud. Everyone congratulating me makes it worse."

**S3 — Burnout self-doubt**
> "I think I'm burning out but I can't tell if it's real burnout or I'm just being lazy."

**S4 — Career fork, time pressure**
> "I have two job offers. One pays 40% more but the team seems toxic. The other is meaningful but the salary stays flat. I have to decide by Friday."

**S5 — Identity / cultural tension**
> "I'm Somali and my parents want me to take a stable government job. I want to start a company. They sacrificed everything for me to be safe and I feel guilty wanting more."

**S6 — Difficult feedback received**
> "My manager told me in my review that I 'talk over people.' I don't think I do. I think she has it out for me."

**S7 — Almost no signal**
> "idk"

Watch what it does with nothing to work with.

**S8 — Resistance / pushback** (uses S1's first response — do this after S1 completes; treat as a continuation, NOT a new session — go back to that session)
> Send as turn 4 of S1: "That's not helpful. You're just asking me questions. Just tell me what to say to him."

Watch how it handles being told its own register isn't working.

**S9 — Celebration**
> "I just closed my first 6-figure deal. I'm so happy I want to cry."

Does it match the energy or default to clinical mode?

**S10 — Grief-adjacent (sensitive but NOT crisis)**
> "My mentor passed away last month. I keep wanting to call him when something happens at work. I don't know how to lead without him in my corner."

It should not surface the crisis card. Watch for over-medicalization or dismissiveness.

## Scoring rubric (per response)

Five axes, 1–5 each, plus one short note.

| Axis | 1 = bad | 5 = eerily good |
|---|---|---|
| **Real-person register** | Therapist cliché — "I hear you, that sounds hard" | Sounds like a perceptive friend who happens to coach |
| **One move, well-chosen** | Multiple questions stacked, OR one-liner that dodges | One move, the RIGHT move for this turn |
| **Got me** | Generic — could be sent to anyone | Picked up on the specific thing I actually said |
| **Push vs. soft** | Hedgy, won't take a position | Has a take, willing to disagree, names what I'm dodging |
| **Length fit** | Too short and dodge-y, OR too long and lecture-y | Length matches the moment |

Also flag any of these (one-word flags in the note):
- `cliché` — "I hear you" / "that sounds [adjective]" / "what's coming up for you"
- `leak` — cited framework by name ("this is the integrity practice")
- `forgot` — lost context across turns
- `>1q` — asked more than one question in a single turn
- `false-crisis` — surfaced crisis card when it shouldn't have (esp. S10)
- `mismatch-energy` — somber on S9, or breezy on S10

## Report format

One Markdown document at the end:

```
# Hogaan — Coaching Quality Audit (Chunk 1)

## Top-line verdict
2–3 sentences. Does the product clear the "real person on the other side" bar? Where does it fall short most?

## Per-scenario log
### S1 — Hard conversation tomorrow
- T1 user: "<opener>"
- T1 bot (condensed to 5–15 words): "..."
- Scores: real-person 3 / one-move 4 / got-me 4 / push 2 / length 3
- Flags: cliché
- Note: one line max
- T2 user: "..."
- T2 bot: "..."
- Scores: ...
- T3 ...
(repeat S2–S10)

## Pattern findings
What broke repeatedly across scenarios. Numbers help — "9/10 openers got a question back, never a take."

## Prompt-tuning suggestions
1–3 concrete edits to §4 of the system prompt. Phrase each as "Replace X with Y, because Z."

## Standout moments
Verbatim quotes — 2–3 best lines, 2–3 worst lines.
```

## Guardrails

- Don't sign out / sign up. One account, multiple sessions.
- Don't send crisis content ("I want to die" etc). S10 is the darkest we go.
- Don't take screenshots mid-stream — wait for the response to settle.
- Stop at 10 scenarios. Don't go fishing for more.
- You're evaluating coaching quality only. UI bugs that block a scenario → mention in one line at the bottom of the report and move on.
