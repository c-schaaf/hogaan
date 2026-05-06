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

// Phase 12 R11 — common-word keywords replaced with phrasal anchors.
// The previous list had 'why', 'voice', 'face', 'change', 'monday morning'
// as bare keywords; they fired on far too many leadership-context messages.
// Phrasal anchors are more specific to the practice the user is wrestling
// with.
const PRACTICE_KEYWORDS: Record<PracticeTag, string[]> = {
  integrity: ['integrity', 'principle', 'standard', 'compromise my', 'cut corners', 'doing right'],
  purpose: [
    'purpose',
    'meaning',
    'mission',
    'what for',
    "what's the point",
    'why am i doing',
    'what am i for',
    'point of this work',
  ],
  accountability: [
    'accountable',
    'accountability',
    'ownership',
    'own this',
    'own that',
    'my fault',
    'on me',
  ],
  dignity: [
    'dignity',
    'respect',
    'humiliate',
    'humiliation',
    'embarrass',
    'lose face',
    'save face',
    'face in front of the team',
  ],
  empathy: [
    'empathy',
    'understand',
    'their perspective',
    'their side',
    'where they',
    'walk in',
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
    'change the way',
    'try a different approach',
    'new way of working',
    'doing things differently',
  ],
  prosperity: ['prosperity', 'thrive', 'win-win', 'positive sum', 'value creation', 'shared'],
  humility: ['humility', 'humble', 'wrong', 'admit', "i don't know", 'pushback', 'truth-teller'],
  democracy: [
    'democracy',
    'fair process',
    'transparent',
    'opaque',
    'governance',
    'how we decide',
    'whose voice',
    'voice in the decision',
    'voice at the table',
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
  /** Phase 11 R17 — runner-up practice if the score table had one. NULL when
   *  the tagger fell back to profile or default. */
  secondaryPracticeTag: PracticeTag | null;
  /** Phase 11 R17 — runner-up level. NULL when only one level scored > 0. */
  secondaryLevelTag: LevelTag | null;
  /** Phase 11 R17 — confidence ∈ [0, 1]. Computed from hit counts and
   *  source: message hits get full credit, profile fallback ~0.4, hard
   *  default 0.1. Turns with confidence < 0.6 should land on the review
   *  queue. */
  confidence: number;
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
  let secondaryPractice: PracticeTag | null = null;
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
      // Phase 11 R17 — secondary = next-best non-zero score (skip the winner).
      let runnerUp: PracticeTag | null = null;
      let runnerUpScore = 0;
      for (const [p, s] of practiceScores) {
        if (p !== best && s > runnerUpScore) {
          runnerUp = p;
          runnerUpScore = s;
        }
      }
      secondaryPractice = runnerUp;
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

  // Score levels similarly; default to 'self'. Track runner-up for R17.
  let level: LevelTag = 'self';
  let bestLevelScore = 0;
  let secondLevel: LevelTag | null = null;
  let secondLevelScore = 0;
  for (const [lvl, keywords] of Object.entries(LEVEL_KEYWORDS) as [LevelTag, string[]][]) {
    let s = 0;
    for (const k of keywords) {
      if (lower.includes(k)) {
        s += 1;
      }
    }
    if (s > bestLevelScore) {
      secondLevel = level;
      secondLevelScore = bestLevelScore;
      level = lvl;
      bestLevelScore = s;
    } else if (s > secondLevelScore && s > 0) {
      secondLevel = lvl;
      secondLevelScore = s;
    }
  }
  // secondLevel must be non-zero score AND distinct from primary.
  const secondaryLevel: LevelTag | null = secondLevelScore > 0 ? secondLevel : null;

  // Phase 11 R17 — confidence in [0, 1].
  //   message source: hit count → 0.6 floor + 0.1 per extra hit, capped at 1.0
  //   profile source: 0.4 (informed but not message-driven)
  //   fallback:       0.1 (we are guessing)
  let confidence: number;
  if (source === 'message') {
    confidence = Math.min(1.0, 0.6 + 0.1 * Math.max(0, hits - 1));
  } else if (source === 'profile') {
    confidence = 0.4;
  } else {
    confidence = 0.1;
  }

  return {
    practiceTag: practice,
    levelTag: level,
    tagSource: source,
    hits,
    secondaryPracticeTag: secondaryPractice,
    secondaryLevelTag: secondaryLevel,
    confidence,
  };
}

/** Test seam — exposes the keyword tables for audit. */
export const _internal = { PRACTICE_KEYWORDS, LEVEL_KEYWORDS };
