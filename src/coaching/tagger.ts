import type { LevelTag, PracticeTag } from '../shared/types/index.js';

/**
 * Process #2 Step 6 — practice + level pre-tagging.
 *
 * Deterministic keyword-based DMN. v1 prioritizes:
 *   1. Profile-default mappedPractices (intersection with message keywords).
 *   2. Explicit message signals (12 practice keyword sets + 4 level keyword sets).
 *   3. Fallback: profile.mappedPractices[0] OR 'integrity' default.
 *
 * Phase 9 plan §4C.3 widens this to a multi-input DMN that includes intent,
 * memory recurrence, etc. — Phase 7 ships the deterministic v1.
 */

const PRACTICE_KEYWORDS: Record<PracticeTag, string[]> = {
  integrity: ['integrity', 'principle', 'standard', 'compromise my', 'cut corners', 'doing right'],
  purpose: ['purpose', 'why', 'meaning', 'mission', 'what for', "what's the point"],
  accountability: [
    'accountable',
    'accountability',
    'ownership',
    'own this',
    'own that',
    'my fault',
    'on me',
  ],
  dignity: ['dignity', 'respect', 'humiliate', 'humiliation', 'embarrass', 'face'],
  empathy: [
    'empathy',
    'understand',
    'their perspective',
    'their side',
    'where they',
    'walk in',
    'monday morning',
  ],
  inclusion: [
    'inclusion',
    'inclusive',
    'diverse',
    'diversity',
    'left out',
    'excluded',
    'unheard',
    'quieter voice',
  ],
  assets: ['asset', 'strength', 'capability', 'resource', 'what we have', 'what i have'],
  innovation: [
    'innovate',
    'innovation',
    'new approach',
    'experiment',
    'try something new',
    'change',
  ],
  prosperity: ['prosperity', 'thrive', 'win-win', 'positive sum', 'value creation', 'shared'],
  humility: ['humility', 'humble', 'wrong', 'admit', "i don't know", 'pushback', 'truth-teller'],
  democracy: [
    'democracy',
    'fair process',
    'voice',
    'transparent',
    'opaque',
    'governance',
    'how we decide',
  ],
  peace: ['peace', 'feud', 'conflict', 'tension', 'rivalry', 'cycle', 'escalation', 'de-escalate'],
};

const LEVEL_KEYWORDS: Record<LevelTag, string[]> = {
  self: [
    'i feel',
    "i'm feeling",
    "i'm sleepless",
    "i'm stuck",
    'my own',
    'within myself',
    'my integrity',
    'my values',
  ],
  team: [
    'my team',
    'my report',
    'my reports',
    'my direct',
    'we as a team',
    'our team',
    'one of my',
  ],
  organization: [
    'the org',
    'organization',
    'company',
    'leadership team',
    'exec team',
    'board',
    'institution',
    'function',
  ],
  community: [
    'community',
    'sector',
    'industry',
    'public',
    'civic',
    'country',
    'society',
    'profession',
  ],
};

export interface TagResult {
  practiceTag: PracticeTag;
  levelTag: LevelTag;
  /** 'profile' | 'message' | 'fallback' — for trace/audit. */
  tagSource: 'profile' | 'message' | 'fallback';
  /** Confidence proxy: how many keyword hits drove the tag (0+). */
  hits: number;
}

const VALID_PRACTICES: readonly PracticeTag[] = [
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

export function tagPracticeAndLevel(message: string, profileMapped: PracticeTag[] = []): TagResult {
  const lower = message.toLowerCase();

  // Score each practice by keyword hits.
  const practiceScores = new Map<PracticeTag, number>();
  for (const [practice, keywords] of Object.entries(PRACTICE_KEYWORDS) as [
    PracticeTag,
    string[],
  ][]) {
    let score = 0;
    for (const k of keywords) {
      if (lower.includes(k)) {
        score += 1;
      }
    }
    if (score > 0) {
      practiceScores.set(practice, score);
    }
  }

  // Pick practice: highest message score, breaking ties via profile.mappedPractices order.
  let practice: PracticeTag | null = null;
  let source: TagResult['tagSource'] = 'fallback';
  let hits = 0;
  if (practiceScores.size > 0) {
    let best: PracticeTag | null = null;
    let bestScore = 0;
    for (const [p, s] of practiceScores) {
      if (s > bestScore) {
        best = p;
        bestScore = s;
      } else if (s === bestScore && best !== null && profileMapped.length > 0) {
        // Tie: prefer the one earlier in profile.mappedPractices.
        const bestRank = profileMapped.indexOf(best);
        const challengerRank = profileMapped.indexOf(p);
        if (challengerRank !== -1 && (bestRank === -1 || challengerRank < bestRank)) {
          best = p;
        }
      }
    }
    if (best !== null) {
      practice = best;
      source = 'message';
      hits = bestScore;
    }
  }

  if (practice === null && profileMapped.length > 0) {
    const first = profileMapped[0];
    if (first !== undefined && VALID_PRACTICES.includes(first)) {
      practice = first;
      source = 'profile';
    }
  }

  if (practice === null) {
    practice = 'integrity'; // safe v1 default
    source = 'fallback';
  }

  // Score levels similarly; default to 'self'.
  let level: LevelTag = 'self';
  let bestLevelScore = 0;
  for (const [lvl, keywords] of Object.entries(LEVEL_KEYWORDS) as [LevelTag, string[]][]) {
    let s = 0;
    for (const k of keywords) {
      if (lower.includes(k)) {
        s += 1;
      }
    }
    if (s > bestLevelScore) {
      level = lvl;
      bestLevelScore = s;
    }
  }

  return { practiceTag: practice, levelTag: level, tagSource: source, hits };
}

/** Test seam — exposes the keyword tables for audit. */
export const _internal = { PRACTICE_KEYWORDS, LEVEL_KEYWORDS };
