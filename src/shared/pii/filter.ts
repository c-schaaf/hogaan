/**
 * Decision D2 (context-and-connections build plan) — privacy filter applied
 * to every piece of user-derived text before it reaches a model provider.
 *
 * Hard Rule 3 as modified by D2: work context (job title, industry, team
 * roles) and FIRST names may reach the model. Email addresses, phone
 * numbers, and surnames may not.
 *
 * This runs inside src/shared/llm/ (the only place provider calls happen),
 * so every caller — live chat, session titles, the background brief
 * updater, the MCP `coach` tool — goes through it. Library content (the
 * founder's system prompt and knowledge digest) is passed as `trusted` and
 * skipped, because it legitimately names public people (e.g. the founder).
 *
 * Surname detection is heuristic. It is tuned to over-remove rather than
 * under-remove: "Sarah Johnson" -> "Sarah", "Dr. Patel" -> "Dr. [name]".
 * Known limits (documented in the build report): a lone surname used
 * without a first name or title ("Johnson said no") is only caught when it
 * is a known surname passed in `knownSurnames`; some two-word proper nouns
 * that are not names ("Google Docs") lose their second word.
 */

export interface PiiFilterOptions {
  /** Surnames known for this leader / their colleagues — always removed. */
  knownSurnames?: readonly string[];
}

export const EMAIL_PLACEHOLDER = '[email removed]';
export const PHONE_PLACEHOLDER = '[phone removed]';
export const NAME_PLACEHOLDER = '[name]';

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// Candidate phone runs: optional +, digits with spaces / dots / dashes /
// parentheses. Commas are deliberately excluded so "1,500,000" never matches.
const PHONE_CANDIDATE_RE = /(?<![\w$£€.])\+?\(?\d[\d\s().-]{5,}\d(?![\w])/g;

const HONORIFIC_RE =
  /\b(Mr|Mrs|Ms|Mx|Miss|Dr|Prof|Professor|Sir|Madam|Dame)\.?\s+\p{Lu}[\p{L}'’-]+/gu;

/** Words that are capitalized for reasons other than being a given name. */
const NOT_A_GIVEN_NAME = new Set(
  `I I'm I've I'd I'll A An The This That These Those My Our Your His Her Their Its We You They He She It
  Dear Hi Hello Hey Thanks Thank Please Yes No Maybe Also But And Or So If When Then After Before Since Because
  While During Every Each Last Next Yesterday Today Tonight Tomorrow Recently Lately Honestly Actually Still
  Just Now Here There What Why How Who Where Which Should Could Would Can Will Do Does Did Is Are Was Were
  Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August
  September October November December Purpose Integrity Accountability Dignity Empathy Inclusion Assets
  Innovation Prosperity Humility Peace Democracy Self Team Organization Community Hogaan
  New San Santa Los Las United North South East West Saint St Mount Fort Port Lake Great Upper Lower Central
  Hamse Somali Somalia Minnesota Minneapolis Kenya Nairobi Mogadishu America American European Africa African
  Google Microsoft Apple Amazon Meta Slack Zoom Teams Board CEO CFO COO CTO VP HR`.split(/\s+/),
);

/** Second words that mark an organisation / place / product, not a surname. */
const NOT_A_SURNAME = new Set(
  `Inc Corp Corporation LLC Ltd Co Company Group Foundation Fund Trust University College School Academy
  Institute Bank Council Department Ministry Agency Committee Board Club Partners Capital Labs Lab Studio
  Studios Street St Avenue Ave Road Rd Boulevard City County State Province Region District Team Teams Office
  Center Centre Hospital Clinic Church Mosque Temple Project Program Programme Initiative Network Alliance
  Association Society Union Coalition Services Solutions Systems Technologies Health Leadership Coaching
  Conference Summit Day Week Month Year Quarter Q1 Q2 Q3 Q4 York Jersey Zealand Delhi Africa America Kingdom
  States Nations Docs Sheets Slides Drive Calendar Meet Mail Office Review Plan Report Strategy Budget`.split(
    /\s+/,
  ),
);

// A run of 2+ capitalized words separated by single spaces. A word may
// contain more capitals and apostrophes (O'Brien, McDonald, DeShawn) but must
// contain a lowercase letter, so acronyms (CEO, NASA) are not words here.
const CAP_WORD = "\\p{Lu}(?=[\\p{L}'’-]*\\p{Ll})[\\p{L}'’-]+";
const CAP_RUN_RE = new RegExp(`${CAP_WORD}(?:\\s+${CAP_WORD})+`, 'gu');

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripPhones(text: string): string {
  return text.replace(PHONE_CANDIDATE_RE, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return m;
    const trimmed = m.trim();
    // ISO dates and year ranges are not phone numbers.
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return m;
    if (/^\d{4}\s*-\s*\d{4}$/.test(trimmed)) return m;
    // Plain unseparated numbers under 10 digits are more likely amounts/ids.
    const hasSeparator = /[\s().+-]/.test(trimmed);
    if (!hasSeparator && digits.length < 10) return m;
    const leading = m.length - m.trimStart().length;
    return m.slice(0, leading) + PHONE_PLACEHOLDER;
  });
}

function stripNameRuns(text: string): string {
  return text.replace(CAP_RUN_RE, (run) => {
    const words = run.split(/\s+/);
    // Skip leading words that are capitalized for other reasons.
    let i = 0;
    while (i < words.length && NOT_A_GIVEN_NAME.has(words[i] ?? '')) i++;
    const rest = words.slice(i);
    if (rest.length < 2) return run;
    const tail = rest.slice(1);
    if (tail.some((w) => NOT_A_SURNAME.has(w))) return run;
    // Keep the prefix words and the given name; drop the surname(s).
    return [...words.slice(0, i), rest[0]].join(' ');
  });
}

export function stripPii(text: string, opts: PiiFilterOptions = {}): string {
  if (text.length === 0) return text;
  let out = text.replace(EMAIL_RE, EMAIL_PLACEHOLDER);
  out = stripPhones(out);
  out = out.replace(HONORIFIC_RE, (_m, title: string) => `${title}. ${NAME_PLACEHOLDER}`);
  for (const surname of opts.knownSurnames ?? []) {
    const s = surname.trim();
    if (s.length < 2) continue;
    // Unicode-aware word edges (\b is ASCII-only in JS, so "Ödegaard" needs this).
    out = out.replace(
      new RegExp(`\\s*(?<![\\p{L}\\p{N}])${escapeRe(s)}(?![\\p{L}\\p{N}])`, 'giu'),
      '',
    );
  }
  out = stripNameRuns(out);
  return out;
}

/** Surnames from a full name: every word after the first. */
export function surnamesFromFullName(fullName: string | null | undefined): string[] {
  if (fullName === null || fullName === undefined) return [];
  const words = fullName
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1);
  return words.slice(1);
}

/** True if text still contains something the filter would remove. */
export function containsPii(text: string, opts: PiiFilterOptions = {}): boolean {
  return stripPii(text, opts) !== text;
}
