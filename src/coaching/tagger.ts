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
// Phase 12 R11 + R13 — common-word keywords replaced with phrasal anchors;
// situational triggers added. The R13 audit found that the canonical "I had
// to fire someone" prompt didn't tag accountability — only abstract terms
// like 'accountable' and 'ownership' did. Real users describe situations,
// not principles, so the keyword set now covers both axes.
const PRACTICE_KEYWORDS: Record<PracticeTag, string[]> = {
  integrity: [
    'integrity',
    'principle',
    'standard',
    'compromise my',
    'cut corners',
    'doing right',
    // R13 — situational triggers
    'right thing to do',
    'against my values',
    'compromised',
    'not who i am',
    // R12 — Somali (sharaf/honesty/principles)
    'sharafteyda',
    'qiimayaal',
    'mabaadi',
  ],
  purpose: [
    'purpose',
    'meaning',
    'mission',
    'what for',
    "what's the point",
    'why am i doing',
    'what am i for',
    'point of this work',
    // T2 — natural-language variants
    'pointless',
    'why am i even',
    // R12 — Somali (ujeedo/meaning)
    'ujeedo',
    'macno',
    'sababta',
  ],
  accountability: [
    'accountable',
    'accountability',
    'ownership',
    'own this',
    'own that',
    'my fault',
    'on me',
    // R13 — situational triggers
    'had to fire',
    'had to let go',
    'decision fell to me',
    'ended up making the call',
    'stuck with the call',
    'on my shoulders',
    'i made the call',
    'my call to make',
    // R12 — Somali (xil/responsibility)
    'xil',
    "mas'uuliyad",
    'masuuliyad',
    'ii saaran',
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
    // T4 — natural-language variants
    'lost face',
    'losing face',
    // R12 — Somali (sharaf/respect)
    'sharaf',
    'ixtiraam',
    'fool',
  ],
  empathy: [
    'empathy',
    'understand',
    'their perspective',
    'their side',
    'where they',
    'walk in',
    // R13 — situational triggers
    'going through',
    'struggling with',
    'hard time at home',
    'team member is dealing with',
    // R12 — Somali (naxariis/understanding)
    'naxariis',
    'fahmis',
    'dareen',
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
    // R13 — situational triggers
    "doesn't speak up",
    'never says anything',
    'gets talked over',
    // T6 — natural-language variants
    'never speaks up',
    'never speak up',
    'silent in meetings',
    // R12 — Somali (ka mid ah/included)
    'ka mid ah',
    'ka qayb qaad',
    'la-jeclayn',
  ],
  assets: [
    'asset',
    'strength',
    'capability',
    'resource',
    'what we have',
    'what i have',
    // T7 — asset-based reframe targets (cost-cutting / scarcity contexts)
    "what we don't have",
    'morale is low',
    'scarcity',
    // R12 — Somali (waxa aan haysano)
    'waxa aan haysano',
    'awood',
    'kheyraad',
  ],
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
    // T8 — natural-language variant
    'different way of working',
    // R12 — Somali (hal-abuur)
    'hal-abuur',
    'wax cusub',
    'baadhitaan',
  ],
  prosperity: [
    'prosperity',
    'thrive',
    'win-win',
    'positive sum',
    'value creation',
    'shared',
    // T9 — long-view compounding wins
    'compound',
    'compounds',
    'compounding',
    // R12 — Somali (barwaaqo/thriving)
    'barwaaqo',
    'horumar',
    'guusha',
  ],
  humility: [
    'humility',
    'humble',
    'wrong',
    'admit',
    "i don't know",
    'pushback',
    'truth-teller',
    // T19 — self-questioning candidacy framing
    "i'm not sure",
    'not sure i should',
    // R12 — Somali (is-hoosaysiin)
    'is-hoosaysiin',
    'ma garanayo',
    'qalad',
  ],
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
    // T11 — unequal-participation framing
    'voices dominate',
    'dominate every decision',
    'never weigh in',
    // R12 — Somali (dimoqraadiyad/voice)
    'dimoqraadiyad',
    'cod',
    'doorasho',
  ],
  peace: [
    'peace',
    'feud',
    'conflict',
    'tension',
    'rivalry',
    'cycle',
    'escalation',
    'de-escalate',
    // R13 — situational triggers
    'at each other',
    "won't talk",
    'stalemate',
    'deadlocked',
    // R12 — Somali (nabad)
    'nabad',
    'colaad',
    'heshiis',
  ],
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
    // T14 — leader-blames-self phrases (also act as override below).
    'because of me',
    'failing because of me',
    'my fault',
    'on me',
    // R12 — Somali
    'aniga',
    'naftayda',
    'qof ahaan',
  ],
  team: [
    'my team',
    'my report',
    'my reports',
    'my direct',
    'we as a team',
    'our team',
    'one of my',
    // T15 — recurring team-meeting framing
    'standup',
    'stand-up',
    'team meeting',
    'one-on-ones',
    // T16 — deputy / second-in-command relationship
    'number two',
    'my deputy',
    'my second',
    'my right hand',
    // R12 — Somali
    'kooxda',
    'kooxdayda',
    'shaqaalayaasha',
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
    // R12 — Somali
    'shirkadda',
    "hay'adda",
    'ururka',
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
    // T19 — diaspora-council framing
    'diaspora',
    'diaspora council',
    'community council',
    'civic council',
    // T20 — philanthropic-foundation framing
    'foundation',
    'nonprofit',
    'philanthropy',
    // R12 — Somali
    'bulshada',
    'dadweynaha',
    'ummadda',
  ],
};

// T14 — leader-blames-self precedence: when a leader-responsibility phrase
// fires, level=self overrides any team-keyword hits. The leader is the unit
// when accepting blame, even if the message mentions "my team".
const SELF_OVERRIDE_PHRASES: readonly string[] = [
  'because of me',
  'failing because of me',
  'my fault',
  'on me',
];

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
  // T14 — self-override precedence. If a leader-responsibility phrase fires,
  // force level=self even when "my team" / other team-keywords also hit.
  // The previously-winning level becomes the runner-up if it wasn't already self.
  let selfOverrideFired = false;
  for (const phrase of SELF_OVERRIDE_PHRASES) {
    if (lower.includes(phrase)) {
      selfOverrideFired = true;
      break;
    }
  }
  if (selfOverrideFired && level !== 'self') {
    secondLevel = level;
    secondLevelScore = bestLevelScore;
    level = 'self';
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
export const _internal = { PRACTICE_KEYWORDS, LEVEL_KEYWORDS, SELF_OVERRIDE_PHRASES };
