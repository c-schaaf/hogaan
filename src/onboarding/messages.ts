/**
 * Onboarding step messages. v1 hardcoded — all visible user-facing text in
 * one file so a content reviewer can read them as a script.
 *
 * Status: needs Hamse sign-off before Phase A launch (CLAUDE.md hard rule #3).
 * The voice rules library governs the *coach*; these messages govern the
 * *onboarding intake*. Same author, similar voice — warm, brief, useful.
 */

import { BRAND_FRAMEWORK_ATTRIBUTION, BRAND_TAGLINE } from '../shared/brand/constants.js';

export const WELCOME_MESSAGE = `Welcome to Hogaan — *${BRAND_TAGLINE}*.

I'm a coaching presence anchored in ${BRAND_FRAMEWORK_ATTRIBUTION}. I show up here to be useful to you, useful to the people you lead, and useful to the work in front of you.

If you have a sponsor code, send it now (it'll look like *kobciye-3742*). Otherwise just say hi and we'll get started.`;

// Phase 12 R16 — rewritten as flowing prose. The previous version had 3
// numbered bullets with 3 separate bolds per item — Voice Rule 11
// formatting-discipline violations. Now: one bold ("aggregate"), zero
// headers, no bullets. Same content, same disclosures.
export const CONSENT_PROMPT = `Three quick checks before we begin.

I'm an AI built around Hamse's voice and framework — not a therapist, doctor, or lawyer. For mental health crises, I'll point you to specific resources rather than try to handle it myself.

Your phone number is hashed for identity. Your messages stay between us — sponsors see *aggregate* engagement only, never your individual conversations.

I'll send daily prompts on this number. Reply STOP at any time to opt out, completely.

Are you good with these three? Reply yes / sow to continue, or anything else if not.`;

export const CONSENT_DECLINED_MESSAGE = `Understood. I'll stop here. If you change your mind, message again — we can pick up where we left off.`;

// Phase 12 R14 — 12-practice picker. The previous 4-goal taxonomy was
// lossy (4→12 mapping discarded user signal). Now users see all 12
// practices upfront, organized by level. The 4 bolds (Self/Team/Org/
// Community) are level headers — structural picker, not Voice Rule 11
// formatting violations. Documented exception in
// tests/onboarding/messages-formatting.test.ts.
export const GOAL_PROMPT = `Hogaan is anchored in 12 leadership practices, organized across four levels — Self, Team, Organization, Community.

*Self:* Integrity, Purpose, Accountability
*Team:* Dignity, Empathy, Inclusion
*Organization:* Assets, Innovation, Prosperity
*Community:* Humility, Democracy, Peace

Which two or three are you most working on right now? You can name them, or just reply ALL and we'll let your messages tell us where to focus.`;

export const GOAL_RETRY_PROMPT = `I didn't quite catch that. Reply with practice names (integrity, empathy, peace, etc.) — pick two or three, or reply ALL.`;

/**
 * Phase 12 R14 — inline-gloss acknowledgment for a user's selected practices.
 *
 * Glosses (locked content):
 */
const PRACTICE_GLOSSES: Record<string, string> = {
  integrity: 'showing up consistently with what you believe, even when it costs you',
  purpose: "the work you'd still do if no one was watching",
  accountability: 'owning the leadership artifact — the call you made, the team you shaped',
  dignity: "preserving someone's standing while telling them the hard truth",
  empathy: 'understanding the interior state of people you lead, not just their behavior',
  inclusion: "making space for voices that don't volunteer themselves",
  assets: 'leading from what your team and org already have, not what they lack',
  innovation: 'trying a different way when the current one stops working',
  prosperity: 'creating value that compounds across people, not zero-sum wins',
  humility: "admitting wrong, listening for what you don't know",
  democracy: 'fair process, transparent decisions, voices that should be heard',
  peace: 'ending cycles of conflict, not winning them',
};

const ALL_TWELVE = Object.keys(PRACTICE_GLOSSES);

/**
 * Format an acknowledgment after the user selects practices in onboarding.
 * Inlines a one-line gloss for up to 3 practices; 4+ are listed by name
 * and only the first 3 get inline gloss. ALL → meta acknowledgment.
 */
export function formatPracticeAcknowledgment(practices: string[]): string {
  if (practices.length === 0 || (practices.length === ALL_TWELVE.length && practices.every((p) => ALL_TWELVE.includes(p)))) {
    return `Good — we'll let your messages tell us where to focus. Tell me what's on your mind this week, and the framework will reveal itself in how we talk about it.`;
  }
  if (practices.length === 1) {
    const p = practices[0]!;
    const gloss = PRACTICE_GLOSSES[p] ?? '';
    return `Good — ${p} is ${gloss}. It's foundational. Tell me what's on your mind right now and we'll start there.`;
  }
  if (practices.length === 2) {
    const [a, b] = practices;
    const ga = PRACTICE_GLOSSES[a!] ?? '';
    const gb = PRACTICE_GLOSSES[b!] ?? '';
    return `Good — ${a} (${ga}) and ${b} (${gb}). Both fit your work. Tell me what's on your mind this week.`;
  }
  if (practices.length === 3) {
    const [a, b, c] = practices;
    const ga = PRACTICE_GLOSSES[a!] ?? '';
    const gb = PRACTICE_GLOSSES[b!] ?? '';
    const gc = PRACTICE_GLOSSES[c!] ?? '';
    return `Good — ${a} (${ga}), ${b} (${gb}), and ${c} (${gc}). Tell me what's on your mind this week.`;
  }
  // 4+: list names, gloss only first three.
  const head = practices.slice(0, 3);
  const rest = practices.slice(3);
  const ga = PRACTICE_GLOSSES[head[0]!] ?? '';
  const gb = PRACTICE_GLOSSES[head[1]!] ?? '';
  const gc = PRACTICE_GLOSSES[head[2]!] ?? '';
  return `Good — ${head[0]} (${ga}), ${head[1]} (${gb}), ${head[2]} (${gc}), plus ${rest.join(', ')}. Tell me what's on your mind this week.`;
}

export const ROLE_PROMPT = `Which best describes where you are right now?

1. *Student* — still building the foundation.
2. *Professional* — leading work, projects, or small teams.
3. *Leader* — running an organization, function, or larger team.

Reply with one number or word.`;

export const ROLE_RETRY_PROMPT = `Pick one — Student / Professional / Leader (or 1 / 2 / 3).`;

export const LOCATION_PROMPT = `Where are you reaching me from? City and country is enough — or just reply *skip* to keep it private.

(This helps me know what time of day to reach you and whether to anchor my responses in local context.)`;

export const FIRST_COACHING_PROMPT = `Tell me — what is one leadership challenge you're sitting with this week?`;

export const NUDGE_4H = `Still here whenever you have a moment. Pick up where we left off.`;
export const NUDGE_48H = `Two days quiet. No pressure — when you're ready, send anything to continue.`;
export const DORMANT_7D = `It's been a week. I've parked your spot. Send anything to pick back up — we'll resume right where you stopped.`;

export const OPT_OUT_CONFIRMATION = `You're opted out. I won't message you again. If you ever want to come back, message this number and I'll reactivate.`;

/** Re-engagement on a duplicate-number signup (Process #1 E8). */
export const WELCOME_BACK_DUPLICATE = `You're already onboarded with me. Send any leadership question and I'll respond — that's where we are.`;
