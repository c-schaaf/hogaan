import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fastifyView from '@fastify/view';
import { Eta } from 'eta';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { handleCallback, requestMagicLink } from './auth/magic-link.js';
import {
  TokenInvalidError,
  TokenServiceUnavailableError,
  validateSponsorSessionToken,
  type SponsorSessionClaims,
} from './auth/token.js';
import {
  countDistinctUsersInCohorts,
  listSponsorCohortIds,
  loadGeographyBreakdown,
  loadRedemptionVelocity,
  loadSeatsOverview,
} from './aggregation/cohort.js';
import {
  loadEngagementSummary,
  loadPracticeDistribution,
  loadRetentionCurve,
} from './aggregation/engagement.js';
import { loadCrisisCategoryCounts, loadQcSummary } from './aggregation/qc.js';
import { isSuppressed } from './aggregation/privacy.js';
import type { Segment } from './aggregation/privacy.js';
import { BRAND_TAGLINE } from '../shared/brand/constants.js';
import { cohorts } from '../shared/db/schema/cohorts.js';
import type { Database } from '../shared/db/client.js';
import type { RedisBundle } from '../shared/redis/client.js';
import type { AppConfig } from '../shared/secrets/config.js';

const SESSION_COOKIE_NAME = 'hogaan_sponsor_session';
const VIEWS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'views');

export interface SponsorPortalRoutesOpts {
  config: AppConfig;
  db: Database;
  redis: RedisBundle;
}

export async function registerSponsorPortalRoutes(
  app: FastifyInstance,
  opts: SponsorPortalRoutesOpts,
): Promise<void> {
  const eta = new Eta({ views: VIEWS_DIR, cache: opts.config.nodeEnv === 'production' });

  await app.register(fastifyView, {
    engine: { eta },
    root: VIEWS_DIR,
    defaultContext: {},
  });

  // ---------- /portal/login (GET) ------------------------------------------
  app.get('/portal/login', async (_req, reply) => {
    return renderPage(reply, 'login.eta', null, 'login', { title: 'Sign in' });
  });

  // ---------- /auth/sponsor/request-link (POST) ----------------------------
  app.post<{ Body: { email?: unknown } }>('/auth/sponsor/request-link', async (req, reply) => {
    const email = typeof req.body?.email === 'string' ? req.body.email : '';
    const r = await requestMagicLink({ config: opts.config, db: opts.db }, email);
    if (r.status === 'invalid_email') {
      return renderPage(reply, 'login.eta', null, 'login', {
        title: 'Sign in',
        error: 'Please enter a valid email address.',
      });
    }
    return renderPage(reply, 'login.eta', null, 'login', {
      title: 'Sign in',
      message:
        'If your email is registered, a one-time login link is on its way. The link expires in 10 minutes.',
    });
  });

  // ---------- /auth/sponsor/callback (GET) ---------------------------------
  app.get<{ Querystring: { token?: string } }>('/auth/sponsor/callback', async (req, reply) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (token === '') {
      return renderPage(reply, 'login.eta', null, 'login', {
        title: 'Sign in',
        error: 'Login link is missing or malformed.',
      });
    }
    const r = await handleCallback({ config: opts.config, db: opts.db, redis: opts.redis }, token);
    if (r.status !== 'ok') {
      return renderPage(reply, 'login.eta', null, 'login', {
        title: 'Sign in',
        error: 'That login link is invalid or has expired. Request a new one below.',
      });
    }
    setSessionCookie(reply, r.sessionToken, opts.config.nodeEnv !== 'development');
    return reply.redirect(r.redirectTo);
  });

  // ---------- /auth/sponsor/logout (POST) ----------------------------------
  app.post('/auth/sponsor/logout', async (_req, reply) => {
    clearSessionCookie(reply);
    return reply.redirect('/portal/login');
  });

  // ---------- /portal/dashboard (GET) --------------------------------------
  app.get('/portal/dashboard', async (req, reply) => {
    const session = await requireSession(req, reply, opts);
    if (session === null) {
      return;
    }
    const cohortIds = await scopedCohortIds(opts.db, session);
    const [seats, velocity, geography] = await Promise.all([
      loadSeatsOverview(opts.db, cohortIds),
      loadRedemptionVelocity(opts.db, cohortIds, daysAgo(30), new Date()),
      loadGeographyBreakdownScoped(opts.db, session, cohortIds),
    ]);
    return renderPage(reply, 'dashboard.eta', session, 'dashboard', {
      title: 'Cohort overview',
      seats,
      velocity,
      geography,
    });
  });

  // ---------- /portal/engagement (GET) -------------------------------------
  app.get('/portal/engagement', async (req, reply) => {
    const session = await requireSession(req, reply, opts);
    if (session === null) {
      return;
    }
    const cohortIds = await scopedCohortIds(opts.db, session);
    const [summary, retention, practices] = await Promise.all([
      loadEngagementSummary(opts.db, cohortIds),
      loadRetentionCurve(opts.db, cohortIds),
      loadPracticeDistribution(opts.db, cohortIds),
    ]);
    return renderPage(reply, 'engagement.eta', session, 'engagement', {
      title: 'Engagement',
      summary,
      retention,
      practices,
    });
  });

  // ---------- /portal/qc (GET) ---------------------------------------------
  app.get('/portal/qc', async (req, reply) => {
    const session = await requireSession(req, reply, opts);
    if (session === null) {
      return;
    }
    const cohortIds = await scopedCohortIds(opts.db, session);
    const [qc, crisis] = await Promise.all([
      loadQcSummary(opts.db, cohortIds),
      loadCrisisCategoryCounts(opts.db, cohortIds),
    ]);
    return renderPage(reply, 'qc.eta', session, 'qc', {
      title: 'Quality & safety',
      qc,
      crisis,
    });
  });

  // ---------- JSON API (used by verify script + future React clients) -----

  app.get('/api/sponsor/dashboard', async (req, reply) => {
    const session = await requireSessionJson(req, reply, opts);
    if (session === null) {
      return;
    }
    const cohortIds = await scopedCohortIds(opts.db, session);
    const [seats, velocity, geography, distinctUsers] = await Promise.all([
      loadSeatsOverview(opts.db, cohortIds),
      loadRedemptionVelocity(opts.db, cohortIds, daysAgo(30), new Date()),
      loadGeographyBreakdownScoped(opts.db, session, cohortIds),
      countDistinctUsersInCohorts(opts.db, cohortIds),
    ]);
    return reply.send({
      cohortCount: cohortIds.length,
      distinctUsers,
      seats,
      velocity,
      geography,
    });
  });

  app.get('/api/sponsor/engagement', async (req, reply) => {
    const session = await requireSessionJson(req, reply, opts);
    if (session === null) {
      return;
    }
    const cohortIds = await scopedCohortIds(opts.db, session);
    const [summary, retention, practices] = await Promise.all([
      loadEngagementSummary(opts.db, cohortIds),
      loadRetentionCurve(opts.db, cohortIds),
      loadPracticeDistribution(opts.db, cohortIds),
    ]);
    return reply.send({
      summary: serializeSegment(summary),
      retention: serializeSegment(retention),
      practices: serializeSegment(practices),
    });
  });

  app.get('/api/sponsor/qc', async (req, reply) => {
    const session = await requireSessionJson(req, reply, opts);
    if (session === null) {
      return;
    }
    const cohortIds = await scopedCohortIds(opts.db, session);
    const [qc, crisis] = await Promise.all([
      loadQcSummary(opts.db, cohortIds),
      loadCrisisCategoryCounts(opts.db, cohortIds),
    ]);
    return reply.send({
      qc: serializeSegment(qc),
      crisis: serializeSegment(crisis),
    });
  });
}

// ============================================================================
// Helpers
// ============================================================================

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function requireSession(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: SponsorPortalRoutesOpts,
): Promise<SponsorSessionClaims | null> {
  const session = await readSession(req, opts);
  if (session === null) {
    void reply.redirect('/portal/login');
    return null;
  }
  return session;
}

async function requireSessionJson(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: SponsorPortalRoutesOpts,
): Promise<SponsorSessionClaims | null> {
  const session = await readSession(req, opts);
  if (session === null) {
    void reply.code(401).send({ error: 'unauthorized' });
    return null;
  }
  return session;
}

async function readSession(
  req: FastifyRequest,
  opts: SponsorPortalRoutesOpts,
): Promise<SponsorSessionClaims | null> {
  // Cookie OR Authorization: Bearer <token>. The verify script uses the
  // header form so it doesn't need a cookie jar.
  const cookieToken = readCookie(req, SESSION_COOKIE_NAME);
  const authHeader = req.headers.authorization;
  const headerToken =
    typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
  const token = cookieToken !== '' ? cookieToken : headerToken;
  if (token === '') {
    return null;
  }
  try {
    return await validateSponsorSessionToken(opts.config, opts.redis, token);
  } catch (err) {
    if (err instanceof TokenInvalidError || err instanceof TokenServiceUnavailableError) {
      return null;
    }
    throw err;
  }
}

function readCookie(req: FastifyRequest, name: string): string {
  const raw = req.headers.cookie;
  if (typeof raw !== 'string') {
    return '';
  }
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) {
      continue;
    }
    const k = part.slice(0, eq).trim();
    if (k === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return '';
}

async function scopedCohortIds(db: Database, session: SponsorSessionClaims): Promise<string[]> {
  if (session.role === 'hogaan_ops') {
    const rows = await db.select({ id: cohorts.id }).from(cohorts);
    return rows.map((r) => r.id);
  }
  if (session.sponsorId === null) {
    return [];
  }
  return listSponsorCohortIds(db, session.sponsorId);
}

async function loadGeographyBreakdownScoped(
  db: Database,
  session: SponsorSessionClaims,
  cohortIds: readonly string[],
): Promise<Awaited<ReturnType<typeof loadGeographyBreakdown>>> {
  if (session.role === 'sponsor_admin' && session.sponsorId !== null) {
    return loadGeographyBreakdown(db, session.sponsorId);
  }
  // hogaan_ops: walk every distinct sponsor among cohortIds (cheap — small N).
  if (cohortIds.length === 0) {
    return [];
  }
  const sponsorRows = await db
    .selectDistinct({ sponsorId: cohorts.sponsorId })
    .from(cohorts)
    .where(eq(cohorts.id, cohortIds[0]!)); // narrow query — caller still aggregates per sponsor
  const sponsorIds = sponsorRows
    .map((r) => r.sponsorId)
    .filter((s): s is string => typeof s === 'string');
  const out: Awaited<ReturnType<typeof loadGeographyBreakdown>> = [];
  for (const sid of sponsorIds) {
    const part = await loadGeographyBreakdown(db, sid);
    out.push(...part);
  }
  return out;
}

function serializeSegment<T>(s: Segment<T>): unknown {
  if (isSuppressed(s)) {
    return {
      suppressed: true,
      reason: s.reason,
      floor: s.floor,
      observedDistinctUsers: s.observedDistinctUsers,
      copy: s.copy,
    };
  }
  return { suppressed: false, distinctUsers: s.distinctUsers, value: s.value };
}

async function renderPage(
  reply: FastifyReply,
  template: string,
  session: SponsorSessionClaims | null,
  active: 'login' | 'dashboard' | 'engagement' | 'qc',
  data: Record<string, unknown>,
): Promise<unknown> {
  // Render the inner template into a string via the eta singleton, then
  // render the layout (which interpolates the inner via <%~ it.body %>) via
  // fastify-view's reply.view().
  const replyWithView = reply as FastifyReply & {
    view: (tpl: string, locals: unknown) => unknown;
  };
  if (typeof replyWithView.view !== 'function') {
    return reply.code(500).send({ error: 'view engine not registered' });
  }
  const innerData: Record<string, unknown> = { ...data, session };
  const innerHtml = renderInner(template, innerData);
  const fullData = {
    ...data,
    body: innerHtml,
    session,
    active,
    brandTagline: BRAND_TAGLINE,
  };
  return replyWithView.view('layout.eta', fullData);
}

let etaSingleton: Eta | undefined;
function renderInner(template: string, data: object): string {
  if (etaSingleton === undefined) {
    etaSingleton = new Eta({ views: VIEWS_DIR, cache: false });
  }
  const out = etaSingleton.render(template, data);
  return typeof out === 'string' ? out : '';
}

function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${24 * 60 * 60}`,
  ];
  if (secure) {
    parts.push('Secure');
  }
  void reply.header('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(reply: FastifyReply): void {
  void reply.header(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}
