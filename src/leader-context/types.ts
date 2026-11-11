/**
 * P1.1 / P1.2 — the leader brief: three short living documents about one
 * leader plus structured work-context fields. Stored encrypted; shown to
 * the leader verbatim on the "What Hogaan knows about you" page (P1.3).
 */

export type BriefDoc = 'profile' | 'goals' | 'notes';
export const BRIEF_DOCS: BriefDoc[] = ['profile', 'goals', 'notes'];

/** Where a line came from. Leader-written lines are never overwritten by the updater. */
export type LineSource = 'conversation' | 'leader' | 'reflection' | 'assistant';

export interface BriefLine {
  id: string;
  text: string;
  source: LineSource;
  updatedAt: string;
}

/** P1.2 structured profile fields. All optional; gathered over time. */
export interface ProfileFields {
  title?: string;
  industry?: string;
  orgType?: string;
  orgSize?: string;
  teamShape?: string;
  /** How they like to be coached, in their words. */
  coachingPreference?: string;
}

export const PROFILE_FIELD_KEYS: (keyof ProfileFields)[] = [
  'title',
  'industry',
  'orgType',
  'orgSize',
  'teamShape',
  'coachingPreference',
];

export const PROFILE_FIELD_LABELS: Record<keyof ProfileFields, string> = {
  title: 'Role',
  industry: 'Industry',
  orgType: 'Organization type',
  orgSize: 'Organization size',
  teamShape: 'Team',
  coachingPreference: 'How they like to be coached',
};

export interface LeaderBrief {
  profileFields: ProfileFields;
  profile: BriefLine[];
  goals: BriefLine[];
  notes: BriefLine[];
  version: number;
  updatedAt: string | null;
  updatedBy: string;
}

export function emptyBrief(): LeaderBrief {
  return {
    profileFields: {},
    profile: [],
    goals: [],
    notes: [],
    version: 0,
    updatedAt: null,
    updatedBy: 'system',
  };
}

/** Caps keep the brief short (prompt cost + "store insights, not raw data"). */
export const MAX_LINES: Record<BriefDoc, number> = { profile: 8, goals: 6, notes: 12 };
export const MAX_LINE_CHARS = 240;
export const MAX_FIELD_CHARS = 120;
