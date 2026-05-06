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
  // Phase 12 R22 — natural acknowledgment endings.
  'that helps',
  'appreciate',
  'noted',
  "that's helpful",
  "i'll think about it",
  "that's all",
  'enough for today',
  'good to know',
  'got it thanks',
];

export type ContinuationDecision = 'continue' | 'close';

// Phase 12 T44 — when an acknowledgment is followed by a coordinating
// conjunction ("but", "however", "yet") AND substantive content (or a
// trailing "?"), the user is mid-thought, not closing.
const TRAILING_CONTINUE_PATTERN = /\b(but|however|yet)\b\s+\S/i;

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
      const idx = norm.indexOf(t);
      if (idx >= 0) {
        const tail = norm.slice(idx + t.length);
        if (TRAILING_CONTINUE_PATTERN.test(tail) || tail.includes('?')) {
          return 'continue';
        }
        return 'close';
      }
      continue;
    }
    const re = new RegExp(`(^|[^a-z])${t}([^a-z]|$)`, 'i');
    const m = re.exec(norm);
    if (m !== null) {
      const tail = norm.slice(m.index + m[0].length);
      if (TRAILING_CONTINUE_PATTERN.test(tail) || tail.includes('?')) {
        return 'continue';
      }
      return 'close';
    }
  }
  return 'continue';
}

export const _CLOSE_TOKENS = CLOSE_TOKENS;
