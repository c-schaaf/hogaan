import { assemblePrompt } from '../prompt-assembly/index.js';
import type { Database } from '../shared/db/client.js';
import { sessions } from '../shared/db/schema/sessions.js';
import { chat } from '../shared/llm/chat.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { asSessionId, asUserId } from '../shared/types/index.js';
import { EVAL_CASES, type EvalCase } from './cases.js';
import { type CaseScore, scoreReply, summarize, type EvalSummary } from './rubric.js';

export interface EvalRunResult {
  model: string;
  startedAt: string;
  summary: EvalSummary;
  rows: { case: EvalCase; reply: string; score: CaseScore; latencyMs: number }[];
}

/**
 * Runs every case through the real prompt assembly and the configured chat
 * model (or the scripted stand-in in demo mode), then scores the replies.
 * Each case is a fresh single-turn conversation for one fixed sample
 * leader profile, so runs are comparable across prompt/model changes.
 */
export async function runEval(
  config: AppConfig,
  db: Database,
  userId: string,
  cases: EvalCase[] = EVAL_CASES,
): Promise<EvalRunResult> {
  const rows: EvalRunResult['rows'] = [];
  let model = 'unknown';
  const created = await db
    .insert(sessions)
    .values({ userId, title: 'coaching eval run', isPrivate: true })
    .returning({ id: sessions.id });
  const sessionId = created[0]!.id;
  for (const c of cases) {
    const bundle = await assemblePrompt(
      config,
      db,
      {
        userId: asUserId(userId),
        sessionId: asSessionId(sessionId),
        responseMode: 'FullCoachingResponse',
        userMessage: c.message,
        userProfile: { experienceBand: '5-10', mappedPractices: ['integrity', 'empathy'] },
        sessionTurns: [],
        retrievedMemories: [],
        historyInMessages: true,
      },
      { awaitLogWrite: true },
    );
    const t0 = Date.now();
    const resp = await chat(
      config,
      {
        systemPrompt: bundle.assembledPrompt,
        ...(bundle.systemBlocks !== undefined ? { systemBlocks: bundle.systemBlocks } : {}),
        messages: [{ role: 'user', content: c.message }],
        maxTokens: 600,
        temperature: 0.7,
      },
      '(no reply)',
    );
    model = resp.modelUsed;
    rows.push({
      case: c,
      reply: resp.text,
      score: scoreReply(c, resp.text),
      latencyMs: Date.now() - t0,
    });
  }
  return {
    model,
    startedAt: new Date().toISOString(),
    summary: summarize(rows.map((r) => r.score)),
    rows,
  };
}

export function renderMarkdown(r: EvalRunResult): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lines = [
    `# Coaching eval — ${r.model} — ${r.startedAt}`,
    '',
    `Cases: ${r.summary.cases} · Mean score: **${pct(r.summary.meanScore)}**`,
    '',
    '| Criterion | Pass rate |',
    '|---|---|',
    ...Object.entries(r.summary.byCriterion).map(([k, v]) => `| ${k} | ${pct(v)} |`),
    '',
    '## Per case',
    '',
  ];
  for (const row of r.rows) {
    const fails = Object.entries(row.score.passed)
      .filter(([, ok]) => !ok)
      .map(([k]) => k);
    lines.push(`### ${row.case.id} (${row.case.category}) — ${pct(row.score.score)}`);
    lines.push(`**Leader:** ${row.case.message}`);
    lines.push('');
    lines.push(`**Coach:** ${row.reply.replace(/\n+/g, ' ')}`);
    if (fails.length > 0) lines.push(`\n_Failed:_ ${fails.join(', ')}`);
    lines.push('');
  }
  return lines.join('\n');
}
