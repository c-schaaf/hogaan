/**
 * P5 "Done when": a 50-seat test cohort can be invited by code and its
 * sponsor sees a report with no individual data. D5: a 9-person cohort
 * returns nothing — enforced in the database view itself.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { planFor } from '../../src/entitlements/index.js';
import { createMoment, recordOutcome } from '../../src/moments/store.js';
import type { EmbeddedDb } from '../../src/shared/db/embedded.js';
import { resetEncryptionCache } from '../../src/shared/db/encryption.js';
import { rowsOf } from '../../src/shared/db/rows.js';
import { sessions } from '../../src/shared/db/schema/sessions.js';
import { buildRealApp, insertLeader } from '../helpers/app.js';
import { demoTestConfig, embeddedTestDb } from '../helpers/embedded.js';

let current = '';
vi.mock('../../src/web-api/supabase-session.js', () => ({
  requireSupabaseSession: vi.fn(() => Promise.resolve({ userId: current })),
}));

const config = demoTestConfig();
let edb: EmbeddedDb;
let app: FastifyInstance;
let sponsor = '';
const leaders: string[] = [];

beforeAll(async () => {
  resetEncryptionCache();
  edb = await embeddedTestDb();
  app = await buildRealApp(config, edb.db);
  sponsor = await insertLeader(config, edb.db, 'Sponsor Person');
}, 60_000);
afterAll(async () => edb.close());

const as = (u: string) => {
  current = u;
};

describe('P5 cohorts and the funder report', () => {
  let orgId = '';
  let bigCohort = '';
  let smallCohort = '';
  let code = '';

  it('a sponsor creates an organization, a 50-seat cohort and an invite code', async () => {
    as(sponsor);
    orgId = (
      await app.inject({
        method: 'POST',
        url: '/api/orgs',
        payload: { name: 'Test Leadership Fund' },
      })
    ).json<{ id: string }>().id;
    bigCohort = (
      await app.inject({
        method: 'POST',
        url: `/api/orgs/${orgId}/cohorts`,
        payload: { name: 'Fellows 2026', seatLimit: 50 },
      })
    ).json<{ id: string }>().id;
    code = (await app.inject({ method: 'POST', url: `/api/cohorts/${bigCohort}/invites` })).json<{
      code: string;
    }>().code;
    expect(code).toMatch(/^HGN-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('joining requires acknowledging the plain statement of what the sponsor can see (P5.4)', async () => {
    const l = await insertLeader(config, edb.db);
    as(l);
    const sp = (await app.inject({ url: '/api/sponsorship' })).json<{
      statement: { cannotSee: string[] };
    }>();
    expect(sp.statement.cannotSee.join(' ')).toContain('Anything you say to Hogaan');
    const res = await app.inject({ method: 'POST', url: '/api/cohorts/join', payload: { code } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'statement_not_acknowledged' });
    leaders.push(l);
  });

  it('50 leaders join by code; the 51st is refused; members hold a sponsored seat', async () => {
    while (leaders.length < 51)
      leaders.push(await insertLeader(config, edb.db, `Leader Number${leaders.length}`));
    for (const [i, l] of leaders.entries()) {
      as(l);
      const r = await app.inject({
        method: 'POST',
        url: '/api/cohorts/join',
        payload: { code: code.toLowerCase(), acknowledged: true },
      });
      if (i < 50) expect(r.json()).toMatchObject({ ok: true, cohortName: 'Fellows 2026' });
      else expect(r.json()).toMatchObject({ error: 'cohort_full' });
    }
    expect(await planFor(config, edb.db, leaders[0]!)).toBe('sponsored');
    expect(await planFor(config, edb.db, leaders[50]!)).toBe('free');
  });

  it('activity accumulates and the sponsor sees aggregates only', async () => {
    for (const l of leaders.slice(0, 12)) {
      await edb.db
        .insert(sessions)
        .values({ userId: l, turnCount: 2, title: `secret topic for ${l}` });
    }
    for (const [i, l] of leaders.slice(0, 6).entries()) {
      const m = await createMoment(config, edb.db, l, {
        what: `Private moment ${i}`,
        source: 'leader',
      });
      await recordOutcome(config, edb.db, l, m!.id, {
        howItWent: i % 2 === 0 ? 'well' : 'hard',
        differently: 'very private reflection text',
        confidenceBefore: 2,
        confidenceAfter: 4,
      });
    }
    as(sponsor);
    const res = await app.inject({ url: `/api/cohorts/${bigCohort}/report` });
    const body = res.json<{ suppressed: boolean; report: Record<string, unknown> }>();
    expect(body.suppressed).toBe(false);
    expect(body.report).toMatchObject({
      enrolled: 50,
      seatLimit: 50,
      coachingSessions: 12,
      momentsPrepared: 6,
      loopsClosed: 6,
      outcomes: { well: 3, mixed: 0, hard: 3 },
      avgConfidenceChange: 2,
    });
    // No individual data anywhere in what the sponsor receives.
    const wire =
      res.body + (await app.inject({ url: `/api/cohorts/${bigCohort}/report.csv` })).body;
    for (const l of leaders) expect(wire).not.toContain(l);
    expect(wire).not.toMatch(
      /Leader Number|secret topic|Private moment|private reflection|@example\.com/,
    );
  });

  it('D5: a 9-person cohort returns nothing — through the API and in the database view', async () => {
    as(sponsor);
    smallCohort = (
      await app.inject({
        method: 'POST',
        url: `/api/orgs/${orgId}/cohorts`,
        payload: { name: 'Pilot', seatLimit: 9 },
      })
    ).json<{ id: string }>().id;
    const smallCode = (
      await app.inject({ method: 'POST', url: `/api/cohorts/${smallCohort}/invites` })
    ).json<{ code: string }>().code;
    for (let i = 0; i < 9; i++) {
      const l = await insertLeader(config, edb.db);
      as(l);
      await app.inject({
        method: 'POST',
        url: '/api/cohorts/join',
        payload: { code: smallCode, acknowledged: true },
      });
      await edb.db.insert(sessions).values({ userId: l, turnCount: 3 });
    }
    as(sponsor);
    const res = await app.inject({ url: `/api/cohorts/${smallCohort}/report` });
    expect(res.json()).toMatchObject({ suppressed: true });
    expect(res.body).not.toMatch(/"enrolled"|"coachingSessions"/);
    expect((await app.inject({ url: `/api/cohorts/${smallCohort}/report.csv` })).statusCode).toBe(
      404,
    );
    const direct = rowsOf(
      await edb.db.execute(
        sql`SELECT * FROM analytics.cohort_report WHERE cohort_id = ${smallCohort}`,
      ),
    );
    expect(direct).toHaveLength(0);
  });

  it('only the sponsor organization admins can see a report', async () => {
    as(leaders[0]!);
    expect((await app.inject({ url: `/api/cohorts/${bigCohort}/report` })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'POST', url: `/api/cohorts/${bigCohort}/invites` })).statusCode,
    ).toBe(404);
  });

  it('leaving frees the seat and ends the sponsored plan', async () => {
    as(leaders[0]!);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/cohorts/${bigCohort}/membership` }))
        .statusCode,
    ).toBe(200);
    expect(await planFor(config, edb.db, leaders[0]!)).toBe('free');
    as(leaders[50]!);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/cohorts/join',
          payload: { code, acknowledged: true },
        })
      ).json(),
    ).toMatchObject({ ok: true });
  });

  it('the metric glossary views exist and answer for the same data', async () => {
    const lc = rowsOf<{ n: string }>(
      await edb.db.execute(sql`SELECT count(*)::text AS n FROM analytics.metric_loops_closed`),
    );
    expect(Number(lc[0]!.n)).toBe(6);
    const al = rowsOf(await edb.db.execute(sql`SELECT * FROM analytics.metric_active_leaders`));
    expect(al.length).toBeGreaterThan(0);
  });
});
