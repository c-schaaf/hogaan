import { eq, sql } from 'drizzle-orm';
import { enqueueJobSafe } from '../jobs/runner.js';
import { assemblePrompt } from '../prompt-assembly/index.js';
import { fetchCoachingContext } from './context-fetch.js';
import type { Database } from '../shared/db/client.js';
import { sessions } from '../shared/db/schema/sessions.js';
import { turns } from '../shared/db/schema/turns.js';
import { isEnabled } from '../shared/flags/index.js';
import { chat } from '../shared/llm/chat.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { asSessionId, asUserId } from '../shared/types/index.js';

/**
 * One coaching reply, non-streaming, using Hogaan's own engine: the same
 * prompt assembly (founder's template, brief, moments), the same D2 privacy
 * filter and the same model as the web chat. Used by the MCP `coach` tool
 * (P3.2) so a leader's own assistant gets Hogaan's voice and method rather
 * than imitating it.
 *
 * The exchange is saved as a normal session (title prefixed "Via your AI
 * assistant") so it appears in Sessions and feeds the brief like any other.
 */
export async function coachOnce(
  config: AppConfig,
  db: Database,
  userId: string,
  situation: string,
): Promise<{ text: string; sessionId: string; turnId: string | null }> {
  const created = await db
    .insert(sessions)
    .values({
      userId,
      metadata: { source: 'mcp' },
      title: `Via your AI assistant: ${situation.replace(/\s+/g, ' ').trim().slice(0, 60)}`,
    })
    .returning({ id: sessions.id });
  const sessionId = created[0]!.id;
  const ctx = await fetchCoachingContext(
    { config, db },
    {
      userId: asUserId(userId),
      sessionId: asSessionId(sessionId),
      query: situation,
      memoryTopN: 0,
      recentTurnsLimit: 0,
      includeBrief: isEnabled(config, 'leaderBrief'),
      includeMoments: isEnabled(config, 'moments'),
    },
  );
  const bundle = await assemblePrompt(config, db, {
    userId: asUserId(userId),
    sessionId: asSessionId(sessionId),
    responseMode: 'FullCoachingResponse',
    userMessage: situation,
    userProfile: ctx.profile,
    sessionTurns: [],
    retrievedMemories: [],
    historyInMessages: true,
    ...(ctx.leaderContextText !== undefined && ctx.leaderContextText.length > 0
      ? { leaderContextText: ctx.leaderContextText }
      : {}),
  });
  const t0 = Date.now();
  const resp = await chat(
    config,
    {
      systemPrompt: bundle.assembledPrompt,
      ...(bundle.systemBlocks !== undefined ? { systemBlocks: bundle.systemBlocks } : {}),
      pii: { knownSurnames: ctx.knownSurnames ?? [] },
      messages: [{ role: 'user', content: situation }],
      maxTokens: 800,
      temperature: 0.7,
    },
    'The coach is having trouble responding right now. Please try again in a moment.',
  );
  const inserted = await db
    .insert(turns)
    .values({
      sessionId,
      userId,
      userMessage: situation,
      responseText: resp.text,
      modelUsed: resp.modelUsed,
      latencyMs: Date.now() - t0,
      libraryVersions: bundle.libraryVersions,
      determinismHash: bundle.determinismHash,
    })
    .returning({ id: turns.id });
  await db
    .update(sessions)
    .set({ lastTurnAt: new Date(), turnCount: sql`${sessions.turnCount} + 1` })
    .where(eq(sessions.id, sessionId));
  if (isEnabled(config, 'leaderBrief')) {
    enqueueJobSafe(db, {
      kind: 'brief.update',
      dedupeKey: `brief:${sessionId}`,
      payload: { userId, sessionId },
      runAfter: new Date(Date.now() + (config.briefUpdateDelayMs ?? 600_000)),
      mode: 'replace',
    });
  }
  return { text: resp.text, sessionId, turnId: inserted[0]?.id ?? null };
}
