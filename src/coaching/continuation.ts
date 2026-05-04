/**
 * Process #2 Step 13 — continuation decision. Determines whether the user has
 * signaled session-end, or wants to keep going.
 *
 * v1 heuristic: explicit goodbye-shaped tokens close the session; everything
 * else continues. Anti-false-positive: bare "thanks" doesn't close the
 * session — many users say it as acknowledgment mid-conversation.
 */

const CLOSE_TOKENS = [
  'bye',
  'goodbye',
  'good night',
  'good bye',
  'ttyl',
  'talk later',
  'gotta go',
  'gtg',
  "i'm done",
  'im done',
  'thanks bye',
  'thanks, bye',
  'until next time',
  'see you',
  'see ya',
  'catch you later',
];

export type ContinuationDecision = 'continue' | 'close';

export function decideContinuation(userMessage: string): ContinuationDecision {
  const norm = userMessage.toLowerCase().trim();
  if (norm.length === 0) {
    return 'continue';
  }
  for (const t of CLOSE_TOKENS) {
    if (norm === t) {
      return 'close';
    }
    if (t.includes(' ')) {
      if (norm.includes(t)) {
        return 'close';
      }
      continue;
    }
    const re = new RegExp(`(^|[^a-z])${t}([^a-z]|$)`, 'i');
    if (re.test(norm)) {
      return 'close';
    }
  }
  return 'continue';
}

export const _CLOSE_TOKENS = CLOSE_TOKENS;
