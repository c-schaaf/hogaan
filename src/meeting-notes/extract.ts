import { backgroundJson } from '../shared/llm/chat.js';
import { stripPii } from '../shared/pii/filter.js';
import type { AppConfig } from '../shared/secrets/config.js';

/**
 * P6.2 — meeting notes by paste into a reflection. Principle 7: store
 * insights, not raw data.
 *
 *   - The pasted notes are processed in this request only. They are never
 *     written to the database, the job queue, the prompt log or any log line.
 *   - The background model returns up to 5 short insights about the
 *     LEADER's leadership, in its own words, other people by role.
 *   - Nothing is saved until the leader picks which insights to keep (they
 *     are then saved through the normal brief API, PII-filtered again).
 *
 * The extraction instruction is an ENGINEERING PLACEHOLDER flagged for the
 * founder's review.
 */
export const MAX_NOTES_CHARS = 20_000;

const SYSTEM = `You help a leader reflect on a meeting they took part in.
You receive their raw meeting notes or transcript.
Return up to 5 short insights about how the LEADER showed up and what they could carry forward:
what went well, what was hard, open loops, commitments they made.
Rules: your own words, never quotes; refer to other people by role only ("a board member"), never by name;
no email addresses or phone numbers; nothing about other people's private lives; each insight under 200 characters.`;

const SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['insights'],
  properties: { insights: { type: 'array', items: { type: 'string' } } },
};

/** Demo-mode stand-in: pick sentences that look like decisions or commitments. */
function scripted(notes: string): { insights: string[] } {
  const sentences = notes
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  const picks = sentences
    .filter((s) =>
      /\b(decid|agree|commit|will|next step|concern|felt|pushed back|asked)\w*/i.test(s),
    )
    .slice(0, 3)
    .map((s) => `From the meeting (demo extraction): ${s.slice(0, 150)}`);
  return {
    insights: picks.length > 0 ? picks : ['(Demo) No clear decisions or commitments found.'],
  };
}

export async function extractMeetingInsights(
  config: AppConfig,
  notes: string,
  knownSurnames: readonly string[] = [],
): Promise<string[]> {
  const text = notes.slice(0, MAX_NOTES_CHARS);
  const { value } = await backgroundJson<{ insights: string[] }>(config, {
    system: SYSTEM,
    user: text,
    schema: SCHEMA,
    maxTokens: 4000,
    pii: { knownSurnames },
    scripted: () => scripted(stripPii(text, { knownSurnames })),
  });
  return (value.insights ?? [])
    .slice(0, 5)
    .map((i) => stripPii(i.replace(/\s+/g, ' ').trim(), { knownSurnames }).slice(0, 240))
    .filter((i) => i.length > 0);
}
