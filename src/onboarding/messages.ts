/**
 * Onboarding step messages. v1 hardcoded — all visible user-facing text in
 * one file so a content reviewer can read them as a script.
 *
 * Status: needs Hamse sign-off before Phase A launch (CLAUDE.md hard rule #3).
 * The voice rules library governs the *coach*; these messages govern the
 * *onboarding intake*. Same author, similar voice — warm, brief, useful.
 */

export const WELCOME_MESSAGE = `Welcome. I'm Hogaan — a coaching presence anchored in Hamse Warfa's twelve-practice framework. I show up here to be useful to you, useful to the people you lead, and useful to the work in front of you.

If you have a sponsor code, send it now (it'll look like *kobciye-3742*). Otherwise just say hi and we'll get started.`;

export const CONSENT_PROMPT = `Before we begin, three quick checks:

1. *AI coaching disclosure.* I'm an AI built around Hamse's voice and framework. I'm not a therapist, not a doctor, not a lawyer. For crisis support, I'll point you to specific resources.

2. *Data handling.* Your phone number is hashed for identity. Your messages stay between us, used only to coach you. Sponsors see *aggregate* engagement, never your individual conversations.

3. *WhatsApp messaging.* I'll send daily prompts and respond to your questions on this number. Reply STOP at any time to opt out.

Are you good with these three? Reply *yes* / *sow* to continue, or anything else if not.`;

export const CONSENT_DECLINED_MESSAGE = `Understood. I'll stop here. If you change your mind, message again — we can pick up where we left off.`;

export const GOAL_PROMPT = `What's the leadership work you most want to grow in?

1. *Leadership confidence* — showing up steadily under pressure.
2. *Communication* — saying the hard thing with care.
3. *Conflict resolution* — working through hard moments without breaking trust.
4. *Career growth* — the next step you're trying to earn.

Reply with the number(s) — one or several. You can change focus anytime.`;

export const GOAL_RETRY_PROMPT = `I didn't catch that. Pick a number 1–4 (or several, comma-separated):

1. Leadership confidence
2. Communication
3. Conflict resolution
4. Career growth`;

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
