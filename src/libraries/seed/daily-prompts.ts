import type { DailyPromptsPayload } from '../types.js';

/**
 * daily_prompts v1 — engineering baseline. **Hamse-owned** content.
 *
 * 24 short daily prompts mixing all 12 practices (2 per practice). Per
 * Voice Rule r10, daily prompts respect the user's time — each fits
 * comfortably in a single phone glance (≤280 chars).
 *
 * Mix: ~half question-shaped (invite reflection), ~quarter reflection-
 * shaped (state an observation, leave space), ~quarter quote-shaped
 * (Hamse-voice anchor with a small commitment).
 *
 * Status: needs Hamse sign-off before Phase A launch.
 */
export const dailyPromptsV1: DailyPromptsPayload = {
  prompts: [
    {
      id: 'integrity-01-question',
      practice: 'integrity',
      kind: 'question',
      body: 'Where today are you tempted to round down on your own standards? Name it to yourself before noon.',
    },
    {
      id: 'integrity-02-reflection',
      practice: 'integrity',
      kind: 'reflection',
      body: 'Sleeplessness about a decision is integrity working — not weakness. What is it asking you to choose?',
    },
    {
      id: 'purpose-01-question',
      practice: 'purpose',
      kind: 'question',
      body: 'When the quarter goes flat, what keeps you in the chair? Whose face do you see?',
    },
    {
      id: 'purpose-02-quote',
      practice: 'purpose',
      kind: 'quote',
      body: '"Be useful to society" — my father said it in the camp. The version of that for your work today is one small thing. Pick it.',
    },
    {
      id: 'accountability-01-question',
      practice: 'accountability',
      kind: 'question',
      body: 'In your last miss, where did you see it coming and stay quiet? Who do you owe a direct conversation to before Friday?',
    },
    {
      id: 'accountability-02-reflection',
      practice: 'accountability',
      kind: 'reflection',
      body: 'Accountability without dignity is shame. With dignity, it is leadership. Try the second one today.',
    },
    {
      id: 'dignity-01-question',
      practice: 'dignity',
      kind: 'question',
      body: 'In your hardest conversation today, what version of dignity do you want the other person to walk away with?',
    },
    {
      id: 'dignity-02-reflection',
      practice: 'dignity',
      kind: 'reflection',
      body: 'Dignity is the floor. Performance management sits on top of it, not in place of it. Notice where you mix the two.',
    },
    {
      id: 'empathy-01-question',
      practice: 'empathy',
      kind: 'question',
      body: 'What is the version of Monday morning your direct report is walking into that you have not seen? Ask one open question this week to find out.',
    },
    {
      id: 'empathy-02-reflection',
      practice: 'empathy',
      kind: 'reflection',
      body: 'Empathy that does not change the decision is performance. Empathy that does is leadership. Where will it change yours today?',
    },
    {
      id: 'inclusion-01-question',
      practice: 'inclusion',
      kind: 'question',
      body: 'In the last three decisions you made, whose perspective was not in the room? What would change if it had been?',
    },
    {
      id: 'inclusion-02-quote',
      practice: 'inclusion',
      kind: 'quote',
      body: 'Inclusion is not a quota. It is the discipline of widening who counts as expert. One name today — who joins the meeting tomorrow?',
    },
    {
      id: 'assets-01-question',
      practice: 'assets',
      kind: 'question',
      body: 'Before you list what your team needs, list what your team already has. Name three assets.',
    },
    {
      id: 'assets-02-reflection',
      practice: 'assets',
      kind: 'reflection',
      body: 'Asset-based leadership is not optimism. It is accuracy about what is in the room. Open your eyes this week.',
    },
    {
      id: 'innovation-01-question',
      practice: 'innovation',
      kind: 'question',
      body: 'Where have you copied a practice that worked elsewhere into a context where it fights you? What is the local version?',
    },
    {
      id: 'innovation-02-reflection',
      practice: 'innovation',
      kind: 'reflection',
      body: 'Innovation in fragile contexts is mostly subtraction. Fewer moving parts, not more. Cut one this week.',
    },
    {
      id: 'prosperity-01-question',
      practice: 'prosperity',
      kind: 'question',
      body: 'In your next big deal, who would be worse off if you succeed? What does winning look like that leaves the ecosystem stronger?',
    },
    {
      id: 'prosperity-02-reflection',
      practice: 'prosperity',
      kind: 'reflection',
      body: "Prosperity is the leadership question hidden inside every revenue conversation. Go find it in today's.",
    },
    {
      id: 'humility-01-question',
      practice: 'humility',
      kind: 'question',
      body: 'When was the last time someone told you something you did not want to hear, professionally? Who was it? Tell them you needed it.',
    },
    {
      id: 'humility-02-reflection',
      practice: 'humility',
      kind: 'reflection',
      body: 'Humility is the willingness to be the second-smartest person in the room. Try it on once today.',
    },
    {
      id: 'democracy-01-question',
      practice: 'democracy',
      kind: 'question',
      body: 'In your last big call, would the people who lost it still defend the process? If not, what was opaque on purpose?',
    },
    {
      id: 'democracy-02-reflection',
      practice: 'democracy',
      kind: 'reflection',
      body: 'Democracy in a team is mostly about process legitimacy — not voting on every choice. Make one process visible this week.',
    },
    {
      id: 'peace-01-question',
      practice: 'peace',
      kind: 'question',
      body: 'Where in your organization is a feud running on autopilot? What is the small gesture that interrupts the cycle without surrendering the principle?',
    },
    {
      id: 'peace-02-reflection',
      practice: 'peace',
      kind: 'reflection',
      body: 'Peace is the discipline of refusing to escalate when you have the standing to. Where will you not-escalate today?',
    },
  ],
  notes:
    'v1 — 24 prompts, 2 per practice. Selection runs deterministic per-user-per-day with practice rotation + history-aware dedup. Pending Hamse sign-off before Phase A.',
};
