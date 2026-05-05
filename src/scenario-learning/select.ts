import { PRACTICE_TAGS } from '../shared/types/index.js';
import type { Scenario, ScenariosPayload } from '../libraries/types.js';

/**
 * Phase 8B scenario selection — keyword-driven match from a free-form user
 * message to one of the 12 scenarios in the active library.
 *
 * Strategy (in priority order):
 *   1. Exact practice name in the message (e.g., "let's practice integrity")
 *      → that practice's scenario.
 *   2. Keyword overlap with title + pitch (case-insensitive bag-of-words).
 *   3. First scenario the user hasn't completed yet, in library order.
 *   4. First scenario in the library.
 *
 * Returns null only when the active library has zero scenarios.
 */

interface SelectInput {
  message: string;
  scenarios: ScenariosPayload['scenarios'];
  /** Scenario ids already completed by this user (Phase 8B state machine). */
  completedScenarioIds: string[];
}

export interface ScenarioSelection {
  scenario: Scenario;
  /** Why this one was chosen — used for trace + debugging. */
  reason: 'practice_name_match' | 'keyword_match' | 'first_uncompleted' | 'first_in_library';
  /** When kind==keyword_match, the score used for the pick. */
  score?: number;
}

export function selectScenario(input: SelectInput): ScenarioSelection | null {
  const { scenarios, completedScenarioIds } = input;
  if (scenarios.length === 0) {
    return null;
  }

  const lowered = input.message.toLowerCase();

  // 1. Practice-name match.
  for (const practice of PRACTICE_TAGS) {
    if (containsWord(lowered, practice)) {
      const found = scenarios.find((s) => s.practice === practice);
      if (found !== undefined) {
        return { scenario: found, reason: 'practice_name_match' };
      }
    }
  }

  // 2. Keyword overlap. Tokenize message + each scenario's title+pitch; score
  //    by token-overlap count (after dropping common words).
  const messageTokens = tokenize(lowered);
  if (messageTokens.size > 0) {
    let best: { scenario: Scenario; score: number } | null = null;
    for (const s of scenarios) {
      const haystack = tokenize(`${s.title} ${s.pitch}`.toLowerCase());
      let score = 0;
      for (const tok of messageTokens) {
        if (haystack.has(tok)) {
          score += 1;
        }
      }
      if (score > 0 && (best === null || score > best.score)) {
        best = { scenario: s, score };
      }
    }
    if (best !== null) {
      return { scenario: best.scenario, reason: 'keyword_match', score: best.score };
    }
  }

  // 3. First uncompleted.
  const uncompleted = scenarios.find((s) => !completedScenarioIds.includes(s.id));
  if (uncompleted !== undefined) {
    return { scenario: uncompleted, reason: 'first_uncompleted' };
  }

  // 4. First in library (everything completed).
  return { scenario: scenarios[0]!, reason: 'first_in_library' };
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'do',
  'for',
  'from',
  'have',
  'i',
  'in',
  'is',
  'it',
  'its',
  'lets',
  "let's",
  'me',
  'my',
  'of',
  'on',
  'or',
  'practice',
  'scenario',
  'that',
  'the',
  'this',
  'to',
  'try',
  'want',
  'we',
  'with',
  'work',
  'would',
  'you',
  'your',
]);

function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  for (const tok of s.split(/[^a-z0-9']+/i)) {
    const t = tok.toLowerCase();
    if (t.length < 3 || STOP_WORDS.has(t)) {
      continue;
    }
    out.add(t);
  }
  return out;
}

function containsWord(haystack: string, word: string): boolean {
  // Word-boundary match — "integrity" should NOT match "disintegrity" etc.
  const re = new RegExp(`\\b${escapeRegex(word)}\\b`, 'i');
  return re.test(haystack);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
