import { eq } from 'drizzle-orm';
import { reportP2 } from '../incident-handling/index.js';
import type { Database } from '../shared/db/client.js';
import { sessions } from '../shared/db/schema/sessions.js';
import { chat } from '../shared/llm/chat.js';
import type { AppConfig } from '../shared/secrets/config.js';

/**
 * Phase C - one-shot Haiku call that summarizes the user's first message
 * into a 3-7 word session title.
 *
 * Called from the /api/chat/turn handler AFTER runCoachingTurn returns,
 * fire-and-forget. Failure is non-blocking: the row keeps NULL title and
 * the Sessions tab falls back to "Untitled session".
 *
 * Only fires once per session - skips if sessions.title is already set.
 */

const SYSTEM_PROMPT = `You are a title generator for a leadership coaching session.

Given the user's opening message, write a SHORT title that captures the leadership topic. Rules:
- 3 to 7 words.
- Title case (capitalize the first word and main nouns/verbs).
- No quotes, no period, no emoji.
- Describe the leadership challenge, not the user. ("Hiring decision for Nairobi office" not "Khadija's hiring question.")
- Keep it concrete. Names of people are fine ("Difficult one-on-one with Marcus").
- If the message is empty or non-leadership, output: Personal reflection

Respond with ONLY the title text. No prefix, no explanation.`;

const FALLBACK = 'Personal reflection';

export async function generateSessionTitle(
  config: AppConfig,
  db: Database,
  sessionId: string,
  userMessage: string,
): Promise<void> {
  if (sessionId === 'pending' || sessionId === '') return;

  // Skip if already titled.
  try {
    const existing = await db
      .select({ title: sessions.title })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (existing[0]?.title !== null && existing[0]?.title !== undefined) return;
  } catch (err) {
    reportP2('session-title: pre-check failed', {
      source: 'PhaseC.SessionTitle',
      extra: { error: err instanceof Error ? err.message : String(err) },
    });
    return;
  }

  let title = FALLBACK;
  try {
    const resp = await chat(
      config,
      {
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 24,
        temperature: 0.2,
        primaryTimeoutMs: 5000,
      },
      FALLBACK,
    );
    const text = resp.text.trim().replace(/^"|"$/g, '').replace(/\.$/, '');
    if (text.length > 0 && text.length <= 120) title = text;
  } catch (err) {
    reportP2('session-title: LLM call failed', {
      source: 'PhaseC.SessionTitle',
      extra: { error: err instanceof Error ? err.message : String(err) },
    });
    // fall through with FALLBACK title; better than a NULL row.
  }

  try {
    await db.update(sessions).set({ title }).where(eq(sessions.id, sessionId));
  } catch (err) {
    reportP2('session-title: persist failed', {
      source: 'PhaseC.SessionTitle',
      extra: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}
