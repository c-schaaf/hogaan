import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { cancelJob } from '../jobs/runner.js';
import { scheduleWeeklyNudge } from '../jobs/phase2-handlers.js';
import {
  createMoment,
  deleteMoment,
  type HowItWent,
  listMoments,
  recordOutcome,
  updateMoment,
} from '../moments/store.js';
import { encryptPlaintext } from '../shared/db/encryption.js';
import { turnRatings } from '../shared/db/schema/moments.js';
import { turns } from '../shared/db/schema/turns.js';
import {
  demoOutbox,
  getPrefs,
  setPrefs,
  unsubscribeAll,
  verifyLink,
} from '../shared/email/proactive.js';
import { isEnabled } from '../shared/flags/index.js';
import { stripPii } from '../shared/pii/filter.js';
import { featureOff } from './context-routes.js';
import { hasCapability } from '../entitlements/index.js';
import { extractMeetingInsights, MAX_NOTES_CHARS } from '../meeting-notes/extract.js';
import type { WebApiRoutesOpts } from './routes.js';
import { requireSupabaseSession } from './supabase-session.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOW: HowItWent[] = ['well', 'mixed', 'hard'];

function parseDate(v: unknown): Date | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string' || v.length === 0) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function confidence(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
}

/**
 * Phase 2 routes.
 *
 *   GET    /api/moments                       list (FEATURE_MOMENTS)
 *   POST   /api/moments {what,withWhom?,happensAt?}
 *   PATCH  /api/moments/:id {happensAt?,status?}
 *   DELETE /api/moments/:id
 *   POST   /api/moments/:id/outcome {howItWent,differently?,confidenceBefore?,confidenceAfter?}
 *   POST   /api/turns/:id/rating {rating,note?}       (FEATURE_RATINGS)
 *   GET    /api/preferences / PATCH /api/preferences  (follow-up / nudge flags)
 *   GET|POST /api/email/unsubscribe?u&t               signed, no sign-in needed
 *   GET    /api/demo/outbox                           demo mode only
 */
export function registerPhase2Routes(app: FastifyInstance, opts: WebApiRoutesOpts): void {
  app.get('/api/moments', async (req, reply) => {
    if (featureOff(reply, opts, 'moments')) return;
    const s = await requireSupabaseSession(req, reply, opts, 'E1_MomentsList');
    if (s === null) return;
    return reply.send({ moments: await listMoments(opts.config, opts.db, s.userId) });
  });

  app.post<{ Body: { what?: unknown; withWhom?: unknown; happensAt?: unknown } }>(
    '/api/moments',
    async (req, reply) => {
      if (featureOff(reply, opts, 'moments')) return;
      const s = await requireSupabaseSession(req, reply, opts, 'E1_MomentWrite');
      if (s === null) return;
      const what = typeof req.body?.what === 'string' ? req.body.what : '';
      if (what.trim().length === 0) return reply.code(400).send({ error: 'what_required' });
      const happensAt = parseDate(req.body?.happensAt);
      const m = await createMoment(opts.config, opts.db, s.userId, {
        what,
        withWhom: typeof req.body?.withWhom === 'string' ? req.body.withWhom : null,
        happensAt: happensAt ?? null,
        source: 'leader',
      });
      if (m === null) return reply.code(409).send({ error: 'already_exists' });
      return reply.send(m);
    },
  );

  app.patch<{ Params: { id: string }; Body: { happensAt?: unknown; status?: unknown } }>(
    '/api/moments/:id',
    async (req, reply) => {
      if (featureOff(reply, opts, 'moments')) return;
      const s = await requireSupabaseSession(req, reply, opts, 'E1_MomentWrite');
      if (s === null) return;
      if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: 'invalid_id' });
      const status = req.body?.status;
      if (status !== undefined && status !== 'upcoming' && status !== 'dismissed') {
        return reply.code(400).send({ error: 'invalid_status' });
      }
      const happensAt = parseDate(req.body?.happensAt);
      const m = await updateMoment(opts.config, opts.db, s.userId, req.params.id, {
        ...(happensAt !== undefined ? { happensAt } : {}),
        ...(status !== undefined ? { status } : {}),
      });
      if (m === null) return reply.code(404).send({ error: 'not_found' });
      return reply.send(m);
    },
  );

  app.delete<{ Params: { id: string } }>('/api/moments/:id', async (req, reply) => {
    if (featureOff(reply, opts, 'moments')) return;
    const s = await requireSupabaseSession(req, reply, opts, 'E1_MomentWrite');
    if (s === null) return;
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: 'invalid_id' });
    const ok = await deleteMoment(opts.db, s.userId, req.params.id);
    return ok ? reply.send({ ok: true }) : reply.code(404).send({ error: 'not_found' });
  });

  app.post<{
    Params: { id: string };
    Body: {
      howItWent?: unknown;
      differently?: unknown;
      confidenceBefore?: unknown;
      confidenceAfter?: unknown;
    };
  }>('/api/moments/:id/outcome', async (req, reply) => {
    if (featureOff(reply, opts, 'moments')) return;
    const s = await requireSupabaseSession(req, reply, opts, 'E1_OutcomeWrite');
    if (s === null) return;
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: 'invalid_id' });
    const how = req.body?.howItWent;
    if (typeof how !== 'string' || !HOW.includes(how as HowItWent)) {
      return reply.code(400).send({ error: 'invalid_how_it_went' });
    }
    const m = await recordOutcome(opts.config, opts.db, s.userId, req.params.id, {
      howItWent: how as HowItWent,
      ...(typeof req.body?.differently === 'string' ? { differently: req.body.differently } : {}),
      confidenceBefore: confidence(req.body?.confidenceBefore),
      confidenceAfter: confidence(req.body?.confidenceAfter),
    });
    if (m === null) return reply.code(404).send({ error: 'not_found' });
    return reply.send(m);
  });

  // P2.4 — rating, pinned to the prompt version + model of the rated turn.
  app.post<{ Params: { id: string }; Body: { rating?: unknown; note?: unknown } }>(
    '/api/turns/:id/rating',
    async (req, reply) => {
      if (featureOff(reply, opts, 'ratings')) return;
      const s = await requireSupabaseSession(req, reply, opts, 'E1_RatingWrite');
      if (s === null) return;
      if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: 'invalid_id' });
      const rating = req.body?.rating;
      if (rating !== 'helpful' && rating !== 'not_helpful') {
        return reply.code(400).send({ error: 'invalid_rating' });
      }
      const t = (
        await opts.db
          .select({
            id: turns.id,
            libraryVersions: turns.libraryVersions,
            determinismHash: turns.determinismHash,
            modelUsed: turns.modelUsed,
          })
          .from(turns)
          .where(and(eq(turns.id, req.params.id), eq(turns.userId, s.userId)))
          .limit(1)
      )[0];
      if (t === undefined) return reply.code(404).send({ error: 'not_found' });
      const lv = t.libraryVersions as { promptTemplates?: { version?: string } } | null;
      const note =
        typeof req.body?.note === 'string' && req.body.note.trim().length > 0
          ? stripPii(req.body.note.trim()).slice(0, 500)
          : null;
      const values = {
        turnId: t.id,
        userId: s.userId,
        rating,
        noteEncrypted: note !== null ? encryptPlaintext(opts.config, note) : null,
        promptVersion: lv?.promptTemplates?.version ?? null,
        determinismHash: t.determinismHash,
        modelUsed: t.modelUsed,
        updatedAt: new Date(),
      };
      await opts.db
        .insert(turnRatings)
        .values(values)
        .onConflictDoUpdate({ target: [turnRatings.turnId, turnRatings.userId], set: values });
      return reply.send({ ok: true, rating });
    },
  );

  const prefsOn = () =>
    isEnabled(opts.config, 'followUpEmail') || isEnabled(opts.config, 'weeklyNudge');

  app.get('/api/preferences', async (req, reply) => {
    if (!prefsOn()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_PreferencesWrite');
    if (s === null) return;
    return reply.send(await getPrefs(opts.db, s.userId));
  });

  app.patch<{ Body: { followupEmailOptIn?: unknown; weeklyNudgeOptIn?: unknown } }>(
    '/api/preferences',
    async (req, reply) => {
      if (!prefsOn()) return reply.code(404).send({ error: 'feature_off' });
      const s = await requireSupabaseSession(req, reply, opts, 'E1_PreferencesWrite');
      if (s === null) return;
      const patch: { followupEmailOptIn?: boolean; weeklyNudgeOptIn?: boolean } = {};
      if (
        typeof req.body?.followupEmailOptIn === 'boolean' &&
        isEnabled(opts.config, 'followUpEmail')
      ) {
        patch.followupEmailOptIn = req.body.followupEmailOptIn;
      }
      if (
        typeof req.body?.weeklyNudgeOptIn === 'boolean' &&
        isEnabled(opts.config, 'weeklyNudge')
      ) {
        patch.weeklyNudgeOptIn = req.body.weeklyNudgeOptIn;
      }
      const prefs = await setPrefs(opts.db, s.userId, patch);
      if (patch.weeklyNudgeOptIn === true) await scheduleWeeklyNudge(opts.db, s.userId);
      if (patch.weeklyNudgeOptIn === false) await cancelJob(opts.db, `nudge:${s.userId}`);
      return reply.send(prefs);
    },
  );

  // One-click unsubscribe from every proactive email. Signed link; works
  // without signing in (RFC 8058 POST and a plain GET page).
  const unsubscribe = async (u: unknown, t: unknown): Promise<boolean> => {
    if (typeof u !== 'string' || typeof t !== 'string' || !UUID_RE.test(u)) return false;
    let ok = false;
    try {
      ok = verifyLink(opts.config, 'unsub', u, t);
    } catch {
      ok = false;
    }
    if (!ok) return false;
    await unsubscribeAll(opts.db, u);
    await cancelJob(opts.db, `nudge:${u}`);
    return true;
  };
  app.get<{ Querystring: { u?: string; t?: string } }>(
    '/api/email/unsubscribe',
    async (req, reply) => {
      const ok = await unsubscribe(req.query.u, req.query.t);
      void reply.type('text/html; charset=utf-8');
      return reply
        .code(ok ? 200 : 400)
        .send(
          ok
            ? '<!doctype html><meta name="viewport" content="width=device-width"><title>Unsubscribed</title><p style="font-family:system-ui;max-width:480px;margin:48px auto;padding:0 16px">You will not get any more check-in emails from Hogaan. You can turn them back on any time in your Profile.</p>'
            : '<!doctype html><title>Link not valid</title><p style="font-family:system-ui;max-width:480px;margin:48px auto;padding:0 16px">This unsubscribe link is not valid. You can turn check-ins off in your Profile.</p>',
        );
    },
  );
  app.post<{ Querystring: { u?: string; t?: string } }>(
    '/api/email/unsubscribe',
    async (req, reply) => {
      const ok = await unsubscribe(req.query.u, req.query.t);
      return reply.code(ok ? 200 : 400).send({ ok });
    },
  );

  // P6.2 — paste meeting notes, get suggested insights. Nothing is stored:
  // the body is not logged (see the route config) and never persisted.
  app.post<{ Body: { notes?: unknown } }>(
    '/api/meeting-notes/insights',
    { logLevel: 'warn' },
    async (req, reply) => {
      if (featureOff(reply, opts, 'meetingNotes')) return;
      const s = await requireSupabaseSession(req, reply, opts, 'E1_MeetingNotes');
      if (s === null) return;
      if (!(await hasCapability(opts.config, opts.db, s.userId, 'connections'))) {
        return reply.code(402).send({ error: 'upgrade_required', capability: 'connections' });
      }
      const notes = typeof req.body?.notes === 'string' ? req.body.notes : '';
      if (notes.trim().length < 20) return reply.code(400).send({ error: 'notes_too_short' });
      if (notes.length > MAX_NOTES_CHARS) return reply.code(400).send({ error: 'notes_too_long' });
      try {
        const insights = await extractMeetingInsights(opts.config, notes);
        return reply.send({ insights, stored: false });
      } catch {
        return reply.code(503).send({ error: 'unavailable' });
      }
    },
  );

  app.get('/api/demo/outbox', async (req, reply) => {
    if (opts.config.demoMode !== true || opts.config.nodeEnv === 'production') {
      return reply.code(404).send({ error: 'not_found' });
    }
    const s = await requireSupabaseSession(req, reply, opts, 'E1_DemoTools');
    if (s === null) return;
    return reply.send({ emails: demoOutbox() });
  });
}
