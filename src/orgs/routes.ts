import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { cohorts } from '../shared/db/schema/orgs.js';
import { isEnabled } from '../shared/flags/index.js';
import type { WebApiRoutesOpts } from '../web-api/routes.js';
import { requireSupabaseSession } from '../web-api/supabase-session.js';
import {
  adminView,
  cohortReport,
  createCohort,
  createInvite,
  createOrg,
  isCohortAdmin,
  isOrgAdmin,
  joinByCode,
  leaveCohort,
  MIN_REPORT_GROUP,
  myMemberships,
  reportCsv,
  SPONSOR_STATEMENT,
} from './store.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * P5 routes (all 404 unless FEATURE_ORGS is on).
 *
 * Leader side:
 *   GET    /api/sponsorship                 my cohorts + what a sponsor can / cannot see (P5.4)
 *   POST   /api/cohorts/join {code, acknowledged: true}
 *   DELETE /api/cohorts/:id/membership      leave (seat freed, plan back to own plan)
 * Sponsor side (organization admins only):
 *   GET    /api/orgs                        orgs I administer, cohorts, seats used
 *   POST   /api/orgs {name, kind?}
 *   POST   /api/orgs/:id/cohorts {name, seatLimit, endsAt?}
 *   POST   /api/cohorts/:id/invites         -> invite code (shown once)
 *   GET    /api/cohorts/:id/report          aggregate report or {suppressed}
 *   GET    /api/cohorts/:id/report.csv
 *
 * Organization creation is open to any signed-in user on the fork. Who may
 * create sponsor organizations in production is a decision for the owners.
 */
export function registerOrgRoutes(app: FastifyInstance, opts: WebApiRoutesOpts): void {
  const off = () => !isEnabled(opts.config, 'orgs');

  app.get('/api/sponsorship', async (req, reply) => {
    if (off()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_Orgs');
    if (s === null) return;
    return reply.send({
      memberships: await myMemberships(opts.db, s.userId),
      statement: SPONSOR_STATEMENT,
      minGroupSize: MIN_REPORT_GROUP,
    });
  });

  app.post<{ Body: { code?: unknown; acknowledged?: unknown } }>(
    '/api/cohorts/join',
    async (req, reply) => {
      if (off()) return reply.code(404).send({ error: 'feature_off' });
      const s = await requireSupabaseSession(req, reply, opts, 'E1_Orgs');
      if (s === null) return;
      if (req.body?.acknowledged !== true) {
        return reply
          .code(400)
          .send({ error: 'statement_not_acknowledged', statement: SPONSOR_STATEMENT });
      }
      const code = typeof req.body?.code === 'string' ? req.body.code : '';
      const r = await joinByCode(opts.db, s.userId, code);
      return r.ok ? reply.send(r) : reply.code(400).send({ error: r.reason });
    },
  );

  app.delete<{ Params: { id: string } }>('/api/cohorts/:id/membership', async (req, reply) => {
    if (off()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_Orgs');
    if (s === null) return;
    if (!UUID_RE.test(req.params.id)) return reply.code(400).send({ error: 'invalid_id' });
    return (await leaveCohort(opts.db, s.userId, req.params.id))
      ? reply.send({ ok: true })
      : reply.code(404).send({ error: 'not_found' });
  });

  app.get('/api/orgs', async (req, reply) => {
    if (off()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_Orgs');
    if (s === null) return;
    return reply.send({ orgs: await adminView(opts.db, s.userId) });
  });

  app.post<{ Body: { name?: unknown; kind?: unknown } }>('/api/orgs', async (req, reply) => {
    if (off()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_Orgs');
    if (s === null) return;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (name === '') return reply.code(400).send({ error: 'name_required' });
    const kind = req.body?.kind;
    const k = kind === 'employer' || kind === 'program' ? kind : 'funder';
    return reply.send(await createOrg(opts.db, s.userId, { name, kind: k }));
  });

  app.post<{
    Params: { id: string };
    Body: { name?: unknown; seatLimit?: unknown; endsAt?: unknown };
  }>('/api/orgs/:id/cohorts', async (req, reply) => {
    if (off()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_Orgs');
    if (s === null) return;
    if (!UUID_RE.test(req.params.id) || !(await isOrgAdmin(opts.db, s.userId, req.params.id))) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const seats = req.body?.seatLimit;
    if (
      name === '' ||
      typeof seats !== 'number' ||
      !Number.isInteger(seats) ||
      seats < 1 ||
      seats > 10000
    ) {
      return reply.code(400).send({ error: 'invalid_cohort' });
    }
    const ends = typeof req.body?.endsAt === 'string' ? new Date(req.body.endsAt) : null;
    return reply.send(
      await createCohort(opts.db, req.params.id, {
        name,
        seatLimit: seats,
        endsAt: ends !== null && !Number.isNaN(ends.getTime()) ? ends : null,
      }),
    );
  });

  app.post<{ Params: { id: string } }>('/api/cohorts/:id/invites', async (req, reply) => {
    if (off()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_Orgs');
    if (s === null) return;
    if (!UUID_RE.test(req.params.id) || !(await isCohortAdmin(opts.db, s.userId, req.params.id))) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.send({ code: await createInvite(opts.db, req.params.id) });
  });

  const loadReport = async (userId: string, cohortId: string) => {
    if (!UUID_RE.test(cohortId) || !(await isCohortAdmin(opts.db, userId, cohortId)))
      return 'forbidden' as const;
    const c = (
      await opts.db
        .select({ name: cohorts.name })
        .from(cohorts)
        .where(eq(cohorts.id, cohortId))
        .limit(1)
    )[0]!;
    return { name: c.name, report: await cohortReport(opts.db, cohortId) };
  };

  app.get<{ Params: { id: string } }>('/api/cohorts/:id/report', async (req, reply) => {
    if (off()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_SponsorReport');
    if (s === null) return;
    const r = await loadReport(s.userId, req.params.id);
    if (r === 'forbidden') return reply.code(404).send({ error: 'not_found' });
    if (r.report === null) {
      return reply.send({
        cohortName: r.name,
        suppressed: true,
        reason: `Reports are only shown for cohorts of at least ${MIN_REPORT_GROUP} leaders, to protect privacy.`,
      });
    }
    return reply.send({ cohortName: r.name, suppressed: false, report: r.report });
  });

  app.get<{ Params: { id: string } }>('/api/cohorts/:id/report.csv', async (req, reply) => {
    if (off()) return reply.code(404).send({ error: 'feature_off' });
    const s = await requireSupabaseSession(req, reply, opts, 'E1_SponsorReport');
    if (s === null) return;
    const r = await loadReport(s.userId, req.params.id);
    if (r === 'forbidden') return reply.code(404).send({ error: 'not_found' });
    if (r.report === null) return reply.code(404).send({ error: 'below_privacy_floor' });
    void reply.header('Content-Type', 'text/csv; charset=utf-8');
    void reply.header('Content-Disposition', 'attachment; filename="hogaan-cohort-report.csv"');
    return reply.send(reportCsv(r.name, r.report));
  });
}
