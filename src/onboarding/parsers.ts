import type { GoalOption, RoleOption } from './types.js';
import { GOAL_OPTIONS, ROLE_OPTIONS } from './types.js';
import type { PracticeTag } from '../shared/types/index.js';

/**
 * Fuzzy yes-parsers. The user might write `yes`, `Yes!`, `sure`, `ok`,
 * `agreed`, `sow` (Somali for "I do/agree"), `haa` (Somali for "yes"), etc.
 *
 * Anything that's clearly negative ("no", "stop", "not interested") is a
 * decline. Anything ambiguous defaults to NOT consenting — consent must be
 * explicit per Process #1 §3.
 */
const YES_TOKENS = [
  'yes',
  'y',
  'yeah',
  'yep',
  'yup',
  'sure',
  'ok',
  'okay',
  'agree',
  'agreed',
  'go',
  'sounds good',
  'sounds great',
  'good',
  'great',
  'fine',
  'sow', // Somali "I do" / consent
  'haa', // Somali "yes"
  "i'm in",
  'im in',
  "let's go",
  'lets go',
  "let's do it",
  'lets do it',
  'continue',
  'proceed',
];

const NO_TOKENS = [
  'no',
  'n',
  'nope',
  'nah',
  'not now',
  "don't",
  'dont',
  'stop',
  'skip',
  'pass',
  'maya', // Somali "no"
  'ma',
];

export type ConsentResult = 'yes' | 'no' | 'ambiguous';

export function parseConsent(text: string): ConsentResult {
  const norm = normalize(text);
  if (norm.length === 0) {
    return 'ambiguous';
  }
  // Check explicit no first — "no" is a substring of many words; we want
  // word-boundary match.
  if (matchesAnyToken(norm, NO_TOKENS)) {
    return 'no';
  }
  if (matchesAnyToken(norm, YES_TOKENS)) {
    return 'yes';
  }
  return 'ambiguous';
}

function matchesAnyToken(norm: string, tokens: string[]): boolean {
  for (const t of tokens) {
    if (norm === t) {
      return true;
    }
    // Word-boundary on either side. For multi-word tokens just check substring.
    if (t.includes(' ')) {
      if (norm.includes(t)) {
        return true;
      }
      continue;
    }
    const re = new RegExp(`(^|[^a-z])${escapeRegex(t)}([^a-z]|$)`, 'i');
    if (re.test(norm)) {
      return true;
    }
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Goal parser. Accepts:
 *   - `1` or `1, 3` or `1 and 3`
 *   - `leadership confidence` / `communication` / `conflict resolution` / `career growth`
 *   - Partial matches: `confidence`, `comms`, `conflict`, `career`
 */
const GOAL_KEYWORDS: Record<GoalOption, string[]> = {
  'Leadership confidence': ['leadership', 'confidence', 'confident'],
  Communication: ['communication', 'communicate', 'comms', 'speaking', 'feedback'],
  'Conflict resolution': ['conflict', 'tension', 'disagreement', 'mediation', 'resolution'],
  'Career growth': ['career', 'promotion', 'growth', 'next step', 'advance'],
};

export interface GoalParseResult {
  goals: GoalOption[];
  /** Raw goals matched, deduplicated and order-preserved. */
  matchedAll: boolean;
}

export function parseGoals(text: string): GoalParseResult | 'invalid' {
  const norm = normalize(text);
  if (norm.length === 0) {
    return 'invalid';
  }

  const matched = new Set<GoalOption>();

  // Numeric tokens 1..4.
  const nums = norm.match(/\b[1-4]\b/g);
  if (nums !== null) {
    for (const n of nums) {
      const idx = Number.parseInt(n, 10) - 1;
      const g = GOAL_OPTIONS[idx];
      if (g !== undefined) {
        matched.add(g);
      }
    }
  }

  // Keyword tokens.
  for (const [goal, keywords] of Object.entries(GOAL_KEYWORDS) as [GoalOption, string[]][]) {
    if (keywords.some((k) => norm.includes(k))) {
      matched.add(goal);
    }
  }

  if (matched.size === 0) {
    return 'invalid';
  }
  return { goals: [...matched], matchedAll: matched.size === GOAL_OPTIONS.length };
}

/** Map goals to twelve practices. PRD §7 §3 affinity. */
export function goalsToPractices(goals: GoalOption[]): PracticeTag[] {
  const practices = new Set<PracticeTag>();
  for (const g of goals) {
    switch (g) {
      case 'Leadership confidence':
        practices.add('integrity');
        practices.add('purpose');
        break;
      case 'Communication':
        practices.add('dignity');
        practices.add('empathy');
        break;
      case 'Conflict resolution':
        practices.add('empathy');
        practices.add('peace');
        break;
      case 'Career growth':
        practices.add('accountability');
        practices.add('purpose');
        break;
    }
  }
  return [...practices];
}

/**
 * Role parser. Accepts `1`/`2`/`3` or fuzzy keywords (`student`, `pro`,
 * `professional`, `leader`, `manager`, `exec`, etc.).
 */
const ROLE_KEYWORDS: Record<RoleOption, string[]> = {
  Student: ['student', 'studying', 'learning', 'apprentice'],
  Professional: ['professional', 'pro ', 'engineer', 'analyst', 'individual contributor', 'ic'],
  Leader: [
    'leader',
    'manager',
    'mgr',
    'director',
    'exec',
    'executive',
    'ceo',
    'founder',
    'head of',
    'lead',
  ],
};

export function parseRole(text: string): RoleOption | 'invalid' {
  const norm = normalize(text);
  if (norm.length === 0) {
    return 'invalid';
  }

  // Exact-number first.
  const nums = norm.match(/\b[1-3]\b/);
  if (nums !== null) {
    const idx = Number.parseInt(nums[0], 10) - 1;
    const r = ROLE_OPTIONS[idx];
    if (r !== undefined) {
      return r;
    }
  }

  // Keyword match. Prefer Leader over Professional when both could match
  // (a "lead engineer" should resolve to Leader, not Professional).
  const keywordOrder: RoleOption[] = ['Leader', 'Student', 'Professional'];
  for (const r of keywordOrder) {
    const keywords = ROLE_KEYWORDS[r];
    if (keywords.some((k) => norm.includes(k))) {
      return r;
    }
  }

  return 'invalid';
}

/**
 * Location parser. Returns the literal string + a heuristic guess at
 * isDiaspora. "skip" / "private" / "rather not" → no location.
 *
 * Diaspora detection v1: reject countries inside Horn of Africa region as
 * non-diaspora (Somalia, Kenya, Ethiopia, Djibouti). Anything else with a
 * country-like token → diaspora. Tests pin a few common cases; Phase 2
 * widens via geocoding (PRD plan §6.5).
 */
export interface LocationParseResult {
  literal: string;
  isDiaspora: boolean;
  /** IANA tz best-guess. Defaults to Africa/Mogadishu (East Africa Time). */
  timezone: string;
}

const HOA_KEYWORDS = [
  'somalia',
  'mogadishu',
  'hargeisa',
  'somaliland',
  'puntland',
  'kismayo',
  'baidoa',
  'jigjiga',
  'kenya',
  'nairobi',
  'mombasa',
  'kisumu',
  'eldoret',
  'ethiopia',
  'addis ababa',
  'addis',
  'djibouti',
];

const SKIP_TOKENS = ['skip', 'private', 'pass', 'rather not', 'no thanks', 'prefer not'];

export function parseLocation(text: string): LocationParseResult | 'skip' {
  const norm = normalize(text);
  if (norm.length === 0) {
    return 'skip';
  }
  if (SKIP_TOKENS.some((t) => norm === t || norm.includes(t))) {
    return 'skip';
  }
  const isHoa = HOA_KEYWORDS.some((k) => norm.includes(k));
  return {
    literal: text.trim(),
    isDiaspora: !isHoa,
    timezone: 'Africa/Mogadishu',
  };
}

/** Trim, lowercase, collapse whitespace, drop punctuation that doesn't carry meaning. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[!?.,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
