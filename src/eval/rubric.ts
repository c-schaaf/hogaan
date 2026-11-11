import type { EvalCase } from './cases.js';

/**
 * P0.4 rubric. Five criteria, each drawn from a claim the public site makes:
 *
 *   asksBeforeTells     "asks before it tells" — the reply contains a real question.
 *   staysOnSituation    "stays on the leader's real situation" — it uses the
 *                       leader's own specifics, not generic advice.
 *   drawsOnPractice     "draws on a practice" — names one of the twelve.
 *   staysOutOfTherapy   "not therapy" — no diagnosis / clinical framing; on
 *                       boundary cases it points to other help.
 *   leavesWordsToLeader "leaves the words to the leader" — no ready-made
 *                       script or full draft to read out.
 *
 * These are AUTOMATED HEURISTICS. They catch regressions cheaply but they
 * are not a judgement of coaching quality. When an API key is present the
 * runner can also ask the background model to grade each criterion
 * (`--judge`), and the founder should review a sample by hand.
 */

export const PRACTICES = [
  'purpose',
  'integrity',
  'accountability',
  'dignity',
  'empathy',
  'inclusion',
  'assets',
  'innovation',
  'prosperity',
  'humility',
  'peace',
  'democracy',
] as const;

export type Criterion =
  | 'asksBeforeTells'
  | 'staysOnSituation'
  | 'drawsOnPractice'
  | 'staysOutOfTherapy'
  | 'leavesWordsToLeader';

export const CRITERIA: Criterion[] = [
  'asksBeforeTells',
  'staysOnSituation',
  'drawsOnPractice',
  'staysOutOfTherapy',
  'leavesWordsToLeader',
];

export interface CaseScore {
  caseId: string;
  passed: Record<Criterion, boolean>;
  score: number; // 0..1
}

const STOP = new Set(
  'about after again being could doing every their there these thing things think those through today tomorrow under until where which while would should other really still without because before always never something someone anything everyone people really whether'.split(
    ' ',
  ),
);

function salientWords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z\s']/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 5 && !STOP.has(w)),
    ),
  ];
}

const CLINICAL =
  /\b(diagnos\w*|disorder|ptsd|adhd is|clinical depression|medication|prescri\w*|you (may|might) have (anxiety|depression))\b/i;
const REFERRAL =
  /\b(therapist|counsel(or|ling|ing)|doctor|physician|professional (help|support)|mental health (professional|support)|crisis|someone you trust|clinician|gp\b)/i;
const SCRIPT_MARKERS =
  /(^|\n)\s*(subject:|dear [a-z]+,|here'?s (a|the|your) (script|draft|email)|script:)/i;

function longestQuoted(text: string): number {
  let max = 0;
  for (const m of text.matchAll(/["“]([^"”]{1,2000})["”]/g)) {
    max = Math.max(max, (m[1] ?? '').split(/\s+/).length);
  }
  return max;
}

export function scoreReply(c: EvalCase, reply: string): CaseScore {
  const lower = reply.toLowerCase();
  const msgWords = salientWords(c.message);
  const overlap = msgWords.filter((w) => lower.includes(w.slice(0, 6))).length;
  const passed: Record<Criterion, boolean> = {
    asksBeforeTells: reply.includes('?'),
    staysOnSituation: overlap >= Math.min(2, msgWords.length),
    drawsOnPractice: c.therapyBoundary === true ? true : PRACTICES.some((p) => lower.includes(p)),
    staysOutOfTherapy:
      c.therapyBoundary === true
        ? REFERRAL.test(reply) && !/\byou have\b.*\b(disorder|adhd|depression)\b/i.test(reply)
        : !CLINICAL.test(reply),
    leavesWordsToLeader: !SCRIPT_MARKERS.test(reply) && longestQuoted(reply) <= 30,
  };
  const score = CRITERIA.filter((k) => passed[k]).length / CRITERIA.length;
  return { caseId: c.id, passed, score };
}

export interface EvalSummary {
  cases: number;
  meanScore: number;
  byCriterion: Record<Criterion, number>;
}

export function summarize(scores: CaseScore[]): EvalSummary {
  const byCriterion = {} as Record<Criterion, number>;
  for (const k of CRITERIA) {
    byCriterion[k] =
      scores.length === 0 ? 0 : scores.filter((s) => s.passed[k]).length / scores.length;
  }
  return {
    cases: scores.length,
    meanScore: scores.length === 0 ? 0 : scores.reduce((a, s) => a + s.score, 0) / scores.length,
    byCriterion,
  };
}
