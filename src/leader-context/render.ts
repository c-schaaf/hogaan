import {
  type LeaderBrief,
  PROFILE_FIELD_KEYS,
  PROFILE_FIELD_LABELS,
  type ProfileFields,
} from './types.js';

export const BRIEF_HEADING = '## What you know about this leader';

/**
 * Renders the brief as the per-leader prompt block (P1.1). Placed after the
 * cache breakpoint. Returns '' when there is nothing to say.
 *
 * The two framing sentences below are ENGINEERING PLACEHOLDERS, not
 * coaching content. They tell the model how to treat the data and are
 * flagged for the founder's review in the build report (Hard Rule 2).
 */
export function renderBriefBlock(brief: LeaderBrief): string {
  const lines: string[] = [];
  for (const k of PROFILE_FIELD_KEYS) {
    const v = brief.profileFields[k];
    if (v !== undefined) lines.push(`- ${PROFILE_FIELD_LABELS[k]}: ${v}`);
  }
  for (const l of brief.profile) lines.push(`- ${l.text}`);
  const goals = brief.goals.map((l) => `- ${l.text}`);
  const notes = brief.notes.map((l) => `- ${l.text}`);
  if (lines.length + goals.length + notes.length === 0) return '';
  const out = [
    BRIEF_HEADING,
    '[engineering placeholder — pending founder review] Context the leader has shared over time. Use it naturally; do not recite it back. The leader can see and edit this list.',
  ];
  if (lines.length > 0) out.push('Profile:', ...lines);
  if (goals.length > 0) out.push('Goals:', ...goals);
  if (notes.length > 0) out.push('Notes (most recent last):', ...notes);
  const missing = missingFields(brief.profileFields);
  if (missing.length > 0) {
    out.push(
      `[engineering placeholder — pending founder review] Not yet known: ${missing.join(', ').toLowerCase()}. If it fits the conversation naturally, you may ask about one of these.`,
    );
  }
  return out.join('\n');
}

export function missingFields(f: ProfileFields): string[] {
  return (['title', 'teamShape', 'industry'] as const)
    .filter((k) => f[k] === undefined)
    .map((k) => PROFILE_FIELD_LABELS[k]);
}
