/**
 * Pre-consent FAQ handler. When a user types a question before saying
 * yes/no to consent, the orchestrator otherwise just re-asks the consent
 * prompt verbatim — which feels robotic and brittle (Khadija field test
 * 2026-05-11).
 *
 * Three hard-coded patterns answer the most common pre-consent questions
 * with a one-line answer + a nudge back to consent. Deterministic, no LLM,
 * no PII risk (user hasn't consented to LLM processing yet).
 *
 * Anything not matching here falls through to the existing re-ask behavior.
 */

interface FaqMatch {
  reply: string;
  /** Tag for trace observability — names which FAQ fired. */
  faq: 'mentor' | 'daily_prompts' | 'scope';
}

const MENTOR_REPLY = `Hogaan is an AI coaching presence, not a mentor-matching service. What I CAN do: help you become the mentor your team needs, or think through how to find one externally.

Reply *yes / sow* to begin and we'll work on whichever one fits.`;

const DAILY_PROMPTS_REPLY = `Daily prompts are short morning reflections — ~80 words, one per day, tied to the 12 leadership practices. Things like *"where in this week's hardest decision was your purpose loudest?"* You can opt out anytime with STOP.

Reply *yes / sow* to begin.`;

const SCOPE_REPLY = `Hogaan is a leadership coach in Hamse Warfa's voice, anchored in his 12 practices. Free for sponsor-cohort users. Text-only, on WhatsApp.

Reply *yes / sow* to begin.`;

/**
 * Detect whether a pre-consent inbound matches one of the known FAQ
 * patterns. Returns the canned reply + the matched FAQ tag, or null.
 *
 * Matching is case-insensitive on word boundaries. Order matters: the
 * mentor pattern fires before the scope pattern so "what can you do about
 * finding a mentor?" routes to the mentor FAQ.
 */
export function detectPreConsentFaq(text: string): FaqMatch | null {
  const norm = text.toLowerCase().trim();
  if (norm.length === 0) {
    return null;
  }

  // Pattern 1: mentor / coach / matchmaking — Khadija asked this twice.
  if (/\b(mentor|matchmaking|matchmaker|live coach|human coach|real coach)\b/.test(norm)) {
    return { reply: MENTOR_REPLY, faq: 'mentor' };
  }

  // Pattern 2: daily prompt content — Khadija asked this too.
  if (/\b(daily prompt|daily prompts|prompts? (will be )?about|what.*prompts?)\b/.test(norm)) {
    return { reply: DAILY_PROMPTS_REPLY, faq: 'daily_prompts' };
  }

  // Pattern 3: scope / "what is this" / "what do you do" / "how does this work".
  if (
    /\b(what (do you do|is (this|hogaan)|can you do)|how does (this|it) work|what.*hogaan|who.*hogaan|tell me about (this|hogaan|you))\b/.test(
      norm,
    )
  ) {
    return { reply: SCOPE_REPLY, faq: 'scope' };
  }

  return null;
}
