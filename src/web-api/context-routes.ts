import type { FastifyInstance, FastifyReply } from 'fastify';
import { buildJobHandlers } from '../jobs/handlers.js';
import { runDueJobs } from '../jobs/runner.js';
import { backgroundJobs } from '../shared/db/schema/background-jobs.js';
import {
  appendLine,
  cleanFields,
  cleanLine,
  deleteBrief,
  findLine,
  getBrief,
  saveBrief,
} from '../leader-context/store.js';
import { BRIEF_DOCS, type BriefDoc, PROFILE_FIELD_KEYS } from '../leader-context/types.js';
import { type FeatureFlag, isEnabled } from '../shared/flags/index.js';
import { eq } from 'drizzle-orm';
import { requireSupabaseSession } from './supabase-session.js';
import type { WebApiRoutesOpts } from './routes.js';
import { registerPhase2Routes } from './phase2-routes.js';

/** 404 when a feature flag is off, so a merged-but-off feature is invisible. */
export function featureOff(
  reply: FastifyReply,
  opts: WebApiRoutesOpts,
  flag: FeatureFlag,
): boolean {
  if (isEnabled(opts.config, flag)) return false;
  void reply.code(404).send({ error: 'feature_off' });
  return true;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * P1.1–P1.3 routes — "What Hogaan knows about you".
 *
 *   GET    /api/brief                    -> the brief, in plain language
 *   PATCH  /api/brief/fields             -> edit work-context fields (P1.2)
 *   POST   /api/brief/lines {doc,text}   -> add a line the leader wrote
 *   PATCH  /api/brief/lines/:id {text}   -> edit any line
 *   DELETE /api/brief/lines/:id          -> delete any line
 *   DELETE /api/brief                    -> delete everything
 *
 * All behind FEATURE_LEADER_BRIEF. Every change is the leader's own action
 * and is marked `updatedBy: 'leader'`.
 */
export function registerContextRoutes(app: FastifyInstance, opts: WebApiRoutesOpts): void {
  app.get('/api/brief', async (req, reply) => {
    if (featureOff(reply, opts, 'leaderBrief')) return;
    const session = await requireSupabaseSession(req, reply, opts, 'E1_BriefGet');
    if (session === null) return;
    return reply.send(await getBrief(opts.config, opts.db, session.userId));
  });

  app.patch<{ Body: Record<string, unknown> }>('/api/brief/fields', async (req, reply) => {
    if (featureOff(reply, opts, 'leaderBrief')) return;
    const session = await requireSupabaseSession(req, reply, opts, 'E1_BriefEdit');
    if (session === null) return;
    const body = req.body ?? {};
    const brief = await getBrief(opts.config, opts.db, session.userId);
    const cleaned = cleanFields(body);
    const next = { ...brief.profileFields };
    for (const k of PROFILE_FIELD_KEYS) {
      if (!(k in body)) continue;
      const v = cleaned[k];
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    brief.profileFields = next;
    await saveBrief(opts.config, opts.db, session.userId, brief, { updatedBy: 'leader' });
    return reply.send(await getBrief(opts.config, opts.db, session.userId));
  });

  app.post<{ Body: { doc?: unknown; text?: unknown } }>('/api/brief/lines', async (req, reply) => {
    if (featureOff(reply, opts, 'leaderBrief')) return;
    const session = await requireSupabaseSession(req, reply, opts, 'E1_BriefEdit');
    if (session === null) return;
    const doc = req.body?.doc;
    const text = req.body?.text;
    if (typeof doc !== 'string' || !BRIEF_DOCS.includes(doc as BriefDoc)) {
      return reply.code(400).send({ error: 'invalid_doc' });
    }
    if (typeof text !== 'string') return reply.code(400).send({ error: 'text_required' });
    const line = await appendLine(
      opts.config,
      opts.db,
      session.userId,
      doc as BriefDoc,
      text,
      'leader',
    );
    if (line === null) return reply.code(400).send({ error: 'text_required' });
    return reply.send(await getBrief(opts.config, opts.db, session.userId));
  });

  app.patch<{ Params: { id: string }; Body: { text?: unknown } }>(
    '/api/brief/lines/:id',
    async (req, reply) => {
      if (featureOff(reply, opts, 'leaderBrief')) return;
      const session = await requireSupabaseSession(req, reply, opts, 'E1_BriefEdit');
      if (session === null) return;
      if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: 'invalid_id' });
      const text = typeof req.body?.text === 'string' ? cleanLine(req.body.text) : null;
      if (text === null) return reply.code(400).send({ error: 'text_required' });
      const brief = await getBrief(opts.config, opts.db, session.userId);
      const at = findLine(brief, req.params.id);
      if (at === null) return reply.code(404).send({ error: 'not_found' });
      const line = brief[at.doc][at.index]!;
      brief[at.doc][at.index] = {
        ...line,
        text,
        // An edited line is the leader's now; the updater will not rewrite it.
        source: 'leader',
        updatedAt: new Date().toISOString(),
      };
      await saveBrief(opts.config, opts.db, session.userId, brief, { updatedBy: 'leader' });
      return reply.send(await getBrief(opts.config, opts.db, session.userId));
    },
  );

  app.delete<{ Params: { id: string } }>('/api/brief/lines/:id', async (req, reply) => {
    if (featureOff(reply, opts, 'leaderBrief')) return;
    const session = await requireSupabaseSession(req, reply, opts, 'E1_BriefDelete');
    if (session === null) return;
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: 'invalid_id' });
    const brief = await getBrief(opts.config, opts.db, session.userId);
    const at = findLine(brief, req.params.id);
    if (at === null) return reply.code(404).send({ error: 'not_found' });
    brief[at.doc] = brief[at.doc].filter((l) => l.id !== req.params.id);
    await saveBrief(opts.config, opts.db, session.userId, brief, { updatedBy: 'leader' });
    return reply.send(await getBrief(opts.config, opts.db, session.userId));
  });

  app.delete('/api/brief', async (req, reply) => {
    if (featureOff(reply, opts, 'leaderBrief')) return;
    const session = await requireSupabaseSession(req, reply, opts, 'E1_BriefDelete');
    if (session === null) return;
    await deleteBrief(opts.db, session.userId);
    return reply.send({ ok: true });
  });

  // DEMO MODE ONLY — run every pending background job now ("fast-forward
  // time"), so the owner can see brief updates and follow-ups without
  // waiting. 404 outside demo mode.
  app.post('/api/demo/run-jobs', async (req, reply) => {
    if (opts.config.demoMode !== true || opts.config.nodeEnv === 'production') {
      return reply.code(404).send({ error: 'not_found' });
    }
    const session = await requireSupabaseSession(req, reply, opts, 'E1_DemoTools');
    if (session === null) return;
    await opts.db
      .update(backgroundJobs)
      .set({ runAfter: new Date(0) })
      .where(eq(backgroundJobs.status, 'pending'));
    // Fast-forward once, then let chained work (brief -> moment -> follow-up)
    // that became due run too. Recurring jobs are not fast-forwarded again.
    let ran = 0;
    for (let i = 0; i < 3; i++) {
      const n = await runDueJobs(opts.db, buildJobHandlers(opts.config, opts.db), {
        quiet: true,
      });
      ran += n;
      if (n === 0) break;
    }
    return reply.send({ ran });
  });

  registerPhase2Routes(app, opts);
}
