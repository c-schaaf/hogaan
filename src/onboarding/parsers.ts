import type { ExperienceBand, RoleOption } from './types.js';
import { ROLE_OPTIONS } from './types.js';
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
 * Phase 12 R14 — 12-practice picker.
 *
 * Replaces the old 4-goal parser with a direct practice picker. Accepts:
 *   - Single practice name (case-insensitive): "integrity", "Empathy"
 *   - Multi-practice: "integrity, peace, humility" / "empathy and dignity"
 *   - Level shorthand: "Self", "Team level" → expands to that level's 3
 *     practices; "all of organization" → assets/innovation/prosperity
 *   - "ALL" / "all twelve" / "everything" → all 12
 *   - Fuzzy: Levenshtein-distance ≤ 2 against the 12 practice names
 *     (handles "humilty" → humility, "empathty" → empathy)
 */
const ALL_PRACTICES: PracticeTag[] = [
  'integrity',
  'purpose',
  'accountability',
  'dignity',
  'empathy',
  'inclusion',
  'assets',
  'innovation',
  'prosperity',
  'humility',
  'democracy',
  'peace',
];

const LEVEL_TO_PRACTICES: Record<string, PracticeTag[]> = {
  self: ['integrity', 'purpose', 'accountability'],
  team: ['dignity', 'empathy', 'inclusion'],
  organization: ['assets', 'innovation', 'prosperity'],
  org: ['assets', 'innovation', 'prosperity'],
  community: ['humility', 'democracy', 'peace'],
};

export interface PracticeParseResult {
  practices: PracticeTag[];
  matchedAll: boolean;
}

export type GoalParseResult = PracticeParseResult & { goals: PracticeTag[] };

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i]![0] = i;
  for (let j = 0; j <= n; j += 1) dp[0]![j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return dp[m]![n]!;
}

export function parsePractices(text: string): PracticeParseResult | 'invalid' {
  const norm = normalize(text);
  if (norm.length === 0) return 'invalid';

  // ALL / everything
  if (
    /\b(all|all twelve|all 12|everything|every practice)\b/.test(norm) &&
    !/\bnot all\b/.test(norm)
  ) {
    return { practices: [...ALL_PRACTICES], matchedAll: true };
  }

  const matched = new Set<PracticeTag>();

  // Level shorthand
  for (const [lvl, practices] of Object.entries(LEVEL_TO_PRACTICES)) {
    const levelRe = new RegExp(`(^|[^a-z])${lvl}( level| practices| ones|$|[^a-z])`);
    if (levelRe.test(norm)) {
      for (const p of practices) matched.add(p);
    }
  }

  // Tokenize comma/and/whitespace-separated input. (normalize already
  // turned commas into spaces, so we split on whitespace + 'and'.)
  const tokens = norm
    .split(/\s+|;|\band\b/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  for (const tok of tokens) {
    // Direct match
    const direct = ALL_PRACTICES.find((p) => p === tok);
    if (direct !== undefined) {
      matched.add(direct);
      continue;
    }
    // Substring match (contains the practice as a word)
    const sub = ALL_PRACTICES.find((p) => tok.includes(p));
    if (sub !== undefined) {
      matched.add(sub);
      continue;
    }
    // Fuzzy: Levenshtein within 2 against any practice
    let best: { p: PracticeTag; d: number } | null = null;
    for (const p of ALL_PRACTICES) {
      const d = levenshtein(tok, p);
      if (d <= 2 && (best === null || d < best.d)) {
        best = { p, d };
      }
    }
    if (best !== null) {
      matched.add(best.p);
    }
  }

  if (matched.size === 0) return 'invalid';
  return {
    practices: [...matched],
    matchedAll: matched.size === ALL_PRACTICES.length,
  };
}

/**
 * Backwards-compat shim — previous callers used parseGoals(...).goals.
 * parsePractices returns .practices; this wrapper aliases.
 */
export function parseGoals(text: string): GoalParseResult | 'invalid' {
  const r = parsePractices(text);
  if (r === 'invalid') return 'invalid';
  return { ...r, goals: r.practices };
}

/**
 * Phase 12 R14 — identity transform. The previous 4-goal taxonomy mapped
 * 4 buckets → 12 practices via a switch. With the 12-practice picker the
 * user already chose practice tags directly; "to profile" is identity.
 */
export function practicesToProfile(practices: PracticeTag[]): PracticeTag[] {
  return [...new Set(practices)];
}

/** Backwards-compat alias. */
export function goalsToPractices(goals: PracticeTag[]): PracticeTag[] {
  return practicesToProfile(goals);
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
  // Phase 12 R15
  CommunityLeader: [
    'community leader',
    'organizer',
    'community organizing',
    'movement',
    'civic leader',
    'civic',
  ],
  Advocate: [
    'advocate',
    'advocacy',
    'activist',
    'campaign',
    'campaigner',
    'human rights',
    'rights',
  ],
};

export function parseRole(text: string): RoleOption | 'invalid' {
  const norm = normalize(text);
  if (norm.length === 0) {
    return 'invalid';
  }

  // Exact-number first (1-5 for the 5-option set after R15).
  const nums = norm.match(/\b[1-5]\b/);
  if (nums !== null) {
    const idx = Number.parseInt(nums[0], 10) - 1;
    const r = ROLE_OPTIONS[idx];
    if (r !== undefined) {
      return r;
    }
  }

  // Keyword match. Phase 12 R15: prefer CommunityLeader > Advocate >
  // Leader > Student > Professional. CommunityLeader before Leader
  // because "community leader" contains "leader". Advocate is distinct
  // enough that order against Leader doesn't matter, but we put it
  // ahead of Leader defensively in case "advocate-leader" comes up.
  const keywordOrder: RoleOption[] = [
    'CommunityLeader',
    'Advocate',
    'Leader',
    'Student',
    'Professional',
  ];
  for (const r of keywordOrder) {
    const keywords = ROLE_KEYWORDS[r];
    if (keywords.some((k) => norm.includes(k))) {
      return r;
    }
  }

  return 'invalid';
}

/**
 * Customer-feedback PR4 — leadership experience band parser. Accepts:
 *   - Friendly prose: "Less than 5", "5 to 10", "Over 10"
 *   - Range strings: "1-5", "5-10", "10+", "15+"
 *   - Plain digits: "1" / "5" / "12" — boundary 5 → '5-10'
 *   - Word-numbers: "three", "seven", "twelve" (1..20)
 *   - Unbounded: "more than 10", "over ten"
 *
 * Returns 'invalid' on garbage. The retry budget in step-handlers.ts
 * applies a default after 3 failed attempts.
 */
const WORD_TO_NUMBER: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};

function bandForYears(years: number): ExperienceBand {
  if (years < 5) {
    return '<5';
  }
  if (years <= 10) {
    return '5-10';
  }
  return '10+';
}

export function parseExperienceBand(text: string): ExperienceBand | 'invalid' {
  const norm = normalize(text);
  if (norm.length === 0) {
    return 'invalid';
  }

  // Unbounded forms first — "10+", "15+", "over 10", "more than 10".
  if (/\b(over|more than|above)\b/.test(norm) && /(10|ten|11|12|13|14|15|20|fifteen|twenty)/.test(norm)) {
    return '10+';
  }
  if (/\b\d+\s*\+/.test(norm)) {
    return '10+';
  }

  // Friendly prose: "less than 5", "less than five".
  if (/\bless than\b/.test(norm)) {
    return '<5';
  }

  // "5 to 10" / "5-10" range, and "1-5" / "1 to 5".
  const rangeMatch = norm.match(/\b(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\b/);
  if (rangeMatch !== null) {
    const high = Number.parseInt(rangeMatch[2]!, 10);
    if (high <= 5) {
      return '<5';
    }
    if (high <= 10) {
      return '5-10';
    }
    return '10+';
  }

  // Plain digit anywhere in the string.
  const digitMatch = norm.match(/\b(\d{1,2})\b/);
  if (digitMatch !== null) {
    const n = Number.parseInt(digitMatch[1]!, 10);
    return bandForYears(n);
  }

  // Word-number — but only if the text is short and number-shaped (not "no
  // experience but I lead by example"). A single word from the dictionary
  // is the cleanest signal.
  const tokens = norm.split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    const n = WORD_TO_NUMBER[t];
    if (n !== undefined) {
      return bandForYears(n);
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
