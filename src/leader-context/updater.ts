import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../shared/db/client.js';
import { decryptPlaintext } from '../shared/db/encryption.js';
import { sessions } from '../shared/db/schema/sessions.js';
import { turns } from '../shared/db/schema/turns.js';
import { users } from '../shared/db/schema/users.js';
import { backgroundJson } from '../shared/llm/chat.js';
import { surnamesFromFullName } from '../shared/pii/filter.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { cleanFields, cleanLine, getBrief, newLine, saveBrief } from './store.js';
import {
  type BriefDoc,
  type BriefLine,
  type LeaderBrief,
  MAX_LINES,
  PROFILE_FIELD_KEYS,
  type ProfileFields,
} from './types.js';

/**
 * P1.1 — background updater. Runs as the `brief.update` job a few minutes
 * after a leader's last message in a session (debounced), never inside the
 * chat turn. Uses the background model (D3: claude-opus-5-5) with
 * structured JSON output.
 *
 * Merge rules (so the leader stays in control — P1.3):
 *   - Lines the leader wrote, and reflection lines, are never changed.
 *   - Lines the updater wrote earlier are replaced by the model's new list
 *     (ids kept where the text is unchanged).
 *   - Structured profile fields are only FILLED when empty; the updater
 *     never overwrites a field the leader (or an earlier update) set.
 *   - Everything passes the D2 PII filter before it is stored.
 *   - Private sessions are skipped entirely.
 *
 * `extras` lets later phases (P2.1 moments) read more out of the same call.
 */

export interface BriefModelOutput {
  profileFields: ProfileFields;
  profile: string[];
  goals: string[];
  notes: string[];
  /** P2.1 — upcoming moments the leader mentioned (see src/moments/). */
  moments: { what: string; withWhom: string; when: string | null }[];
}

export const BRIEF_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['profileFields', 'profile', 'goals', 'notes', 'moments'],
  properties: {
    profileFields: {
      type: 'object',
      additionalProperties: false,
      required: [],
      properties: Object.fromEntries(PROFILE_FIELD_KEYS.map((k) => [k, { type: 'string' }])),
    },
    profile: { type: 'array', items: { type: 'string' } },
    goals: { type: 'array', items: { type: 'string' } },
    notes: { type: 'array', items: { type: 'string' } },
    moments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['what', 'withWhom', 'when'],
        properties: {
          what: { type: 'string' },
          withWhom: { type: 'string' },
          when: { type: ['string', 'null'] },
        },
      },
    },
  },
};

// Engineering instruction for the background extraction call (not
// coaching voice; never shown to the leader). Flagged for founder review.
export const UPDATER_SYSTEM = `You maintain a short private brief about one leader for their leadership coach.
You receive the current brief and the transcript of their latest coaching session.
Return the updated brief as JSON.
Rules:
- Store insights, not raw data: short third-person notes in your own words, never quotes, never message text.
- profileFields: only fields the leader stated or clearly implied (title, industry, orgType, orgSize, teamShape, coachingPreference). Omit unknown fields.
- profile: up to ${MAX_LINES.profile} lines about their work context not covered by the fields.
- goals: up to ${MAX_LINES.goals} lines on what they are working on now; name the related practice when obvious (Purpose, Integrity, Accountability, Dignity, Empathy, Inclusion, Assets, Innovation, Prosperity, Humility, Peace, Democracy).
- notes: up to ${MAX_LINES.notes} lines: what has worked, what has not, open loops ("Open loop: ..."), upcoming moments.
- moments: upcoming conversations or events the leader is preparing for. "withWhom" is a role ("their director"), never a name. "when" is an ISO 8601 date-time if the leader said when, else null.
- Refer to other people by role or first name only. Never include surnames, email addresses or phone numbers.
- Keep everything already in the brief that is still true. Drop what the session shows is no longer true.
- Nothing about health, diagnoses, or family matters beyond what the leader framed as work context.`;

function mergeDoc(existing: BriefLine[], fromModel: string[], surnames: string[]): BriefLine[] {
  const keep = existing.filter((l) => l.source !== 'conversation');
  const prior = new Map(
    existing.filter((l) => l.source === 'conversation').map((l) => [l.text, l]),
  );
  const fresh: BriefLine[] = [];
  for (const raw of fromModel) {
    const t = cleanLine(raw, surnames);
    if (t === null) continue;
    if (keep.some((l) => l.text === t) || fresh.some((l) => l.text === t)) continue;
    fresh.push(prior.get(t) ?? newLine(t, 'conversation'));
  }
  return [...keep, ...fresh];
}

export function mergeBrief(
  brief: LeaderBrief,
  out: BriefModelOutput,
  surnames: string[] = [],
): LeaderBrief {
  const fields = cleanFields(out.profileFields ?? {}, surnames);
  const profileFields: ProfileFields = { ...brief.profileFields };
  for (const k of PROFILE_FIELD_KEYS) {
    if (profileFields[k] === undefined && fields[k] !== undefined) profileFields[k] = fields[k];
  }
  const next: LeaderBrief = { ...brief, profileFields };
  for (const doc of ['profile', 'goals', 'notes'] as BriefDoc[]) {
    next[doc] = mergeDoc(brief[doc], out[doc] ?? [], surnames);
  }
  return next;
}

/** Demo-mode stand-in for the background model: simple pattern extraction. */
export function scriptedBriefExtraction(
  transcript: { user: string; coach: string | null }[],
  sessionTitle: string | null,
): BriefModelOutput {
  const text = transcript.map((t) => t.user).join(' ');
  const fields: ProfileFields = {};
  const team =
    /\b(?:manage|lead|run)\s+(a team of [\w-]+(?: people)?|[\w-]+ (?:people|engineers|staff|analysts|volunteers))/i.exec(
      text,
    );
  if (team?.[1] !== undefined) fields.teamShape = team[1];
  const org =
    /\b(nonprofit|non-profit|startup|social enterprise|city government|public sector|school|hospital|foundation|agency)\b/i.exec(
      text,
    );
  if (org?.[1] !== undefined) fields.orgType = org[1].toLowerCase();
  const role =
    /\bI(?:'m| am) (?:a |an |the )?((?:new |first-time )?(?:manager|director|founder|team lead|program director|executive director|ceo|coordinator))(?=[\s.,;])/i.exec(
      text,
    );
  if (role?.[1] !== undefined) fields.title = role[1].trim();
  const goals: string[] = [];
  for (const m of text.matchAll(/\bI (?:want|need|hope) to ([^.?!]{6,120})/gi)) {
    goals.push(`Wants to ${m[1]!.trim()}`);
  }
  const first = transcript[0]?.user ?? '';
  const notes: string[] = [];
  if (sessionTitle !== null) notes.push(`Worked on: ${sessionTitle}`);
  else if (first.length > 0) notes.push(`Worked on: ${first.split(/[.?!]/)[0]!.slice(0, 120)}`);
  if (first.length > 0) notes.push(`Open loop: ${first.split(/[.?!]/)[0]!.slice(0, 120)}`);
  const moments: BriefModelOutput['moments'] = [];
  const mm =
    /\b(conversation|meeting|1:1|one-on-one|presentation|review|talk) with (?:my |our |the )?([a-z][a-z -]{2,40}?)\b(?: on| this| next)? ?(monday|tuesday|wednesday|thursday|friday|tomorrow)?/i.exec(
      text,
    );
  if (mm !== null) {
    moments.push({
      what: `${mm[1]} with ${mm[2]}`,
      withWhom: `their ${mm[2]!.trim()}`,
      when: mm[3] !== undefined ? resolveDayWord(mm[3]) : null,
    });
  }
  return { profileFields: fields, profile: [], goals, notes, moments };
}

/** 'thursday' -> next Thursday 10:00 local-server time, ISO. 'tomorrow' -> +1 day. */
export function resolveDayWord(word: string, now = new Date()): string {
  const w = word.toLowerCase();
  const d = new Date(now);
  if (w === 'tomorrow') {
    d.setDate(d.getDate() + 1);
  } else {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const target = days.indexOf(w);
    let delta = (target - d.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    d.setDate(d.getDate() + delta);
  }
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

export interface BriefUpdateResult {
  skipped?: 'private' | 'missing' | 'empty';
  brief?: LeaderBrief;
  moments?: BriefModelOutput['moments'];
  model?: string;
}

export async function runBriefUpdate(
  config: AppConfig,
  db: Database,
  input: { userId: string; sessionId: string },
): Promise<BriefUpdateResult> {
  const s = await db
    .select({ id: sessions.id, isPrivate: sessions.isPrivate, title: sessions.title })
    .from(sessions)
    .where(and(eq(sessions.id, input.sessionId), eq(sessions.userId, input.userId)))
    .limit(1);
  const session = s[0];
  if (session === undefined) return { skipped: 'missing' };
  // P1.3: private sessions never write to the brief.
  if (session.isPrivate) return { skipped: 'private' };
  const rows = await db
    .select({ user: turns.userMessage, coach: turns.responseText })
    .from(turns)
    .where(eq(turns.sessionId, session.id))
    .orderBy(asc(turns.createdAt))
    .limit(60);
  if (rows.length === 0) return { skipped: 'empty' };

  const u = await db
    .select({ fullNameEncrypted: users.fullNameEncrypted })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  let surnames: string[] = [];
  const enc = u[0]?.fullNameEncrypted;
  if (typeof enc === 'string' && enc.length > 0) {
    try {
      surnames = surnamesFromFullName(decryptPlaintext(config, enc));
    } catch {
      surnames = [];
    }
  }

  const brief = await getBrief(config, db, input.userId);
  const transcript = rows.map((r) => `Leader: ${r.user}\nCoach: ${r.coach ?? ''}`).join('\n\n');
  const userPayload = [
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    'Current brief (JSON):',
    JSON.stringify({
      profileFields: brief.profileFields,
      profile: brief.profile.map((l) => l.text),
      goals: brief.goals.map((l) => l.text),
      notes: brief.notes.map((l) => l.text),
    }),
    'Latest session transcript:',
    transcript,
  ].join('\n');

  const { value, model } = await backgroundJson<BriefModelOutput>(config, {
    system: UPDATER_SYSTEM,
    user: userPayload,
    schema: BRIEF_SCHEMA,
    pii: { knownSurnames: surnames },
    scripted: () => scriptedBriefExtraction(rows, session.title),
  });
  const merged = mergeBrief(brief, value, surnames);
  await saveBrief(config, db, input.userId, merged, {
    updatedBy: model === 'scripted-demo' ? 'scripted-demo' : `model:${model}`,
    lastSessionId: session.id,
  });
  return { brief: merged, moments: value.moments ?? [], model };
}
