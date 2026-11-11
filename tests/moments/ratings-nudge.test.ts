import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildJobHandlers } from '../../src/jobs/handlers.js';
import { nextMondayMorning } from '../../src/jobs/phase2-handlers.js';
import { runDueJobs } from '../../src/jobs/runner.js';
import { dailyPromptsV1, publishLibraryVersion } from '../../src/libraries/index.js';
import { setClockForTests } from '../../src/shared/clock.js';
import type { EmbeddedDb } from '../../src/shared/db/embedded.js';
import { resetEncryptionCache } from '../../src/shared/db/encryption.js';
import { backgroundJobs } from '../../src/shared/db/schema/background-jobs.js';
import { turnRatings } from '../../src/shared/db/schema/moments.js';
import { sessions } from '../../src/shared/db/schema/sessions.js';
import { turns } from '../../src/shared/db/schema/turns.js';
import { clearDemoOutboxForTests, demoOutbox } from '../../src/shared/email/proactive.js';
import { buildRealApp, insertLeader } from '../helpers/app.js';
import { demoTestConfig, embeddedTestDb } from '../helpers/embedded.js';

let current = '';
vi.mock('../../src/web-api/supabase-session.js', () => ({
  requireSupabaseSession: vi.fn(() => Promise.resolve({ userId: current })),
}));

const config = demoTestConfig();
let edb: EmbeddedDb;
beforeAll(async () => {
  resetEncryptionCache();
  edb = await embeddedTestDb();
  await publishLibraryVersion(edb.db, {
    libraryName: 'daily_prompts',
    version: 'v1',
    payload: dailyPromptsV1,
    publishedBy: 't',
    makeActive: true,
  });
  current = await insertLeader(config, edb.db);
}, 60_000);
afterAll(async () => {
  setClockForTests(null);
  await edb.close();
});

describe('P2.4 ratings', () => {
  it('stores helpful / not helpful with the prompt version and model of the rated turn', async () => {
    const s = (await edb.db.insert(sessions).values({ userId: current }).returning())[0]!;
    const t = (
      await edb.db
        .insert(turns)
        .values({
          sessionId: s.id,
          userId: current,
          userMessage: 'q',
          responseText: 'a',
          modelUsed: 'claude-haiku-4-5',
          libraryVersions: { promptTemplates: { version: 'v3_test', hash: 'h' } },
          determinismHash: 'dh',
        })
        .returning()
    )[0]!;
    const app = await buildRealApp(config, edb.db);
    const res = await app.inject({
      method: 'POST',
      url: `/api/turns/${t.id}/rating`,
      payload: { rating: 'not_helpful', note: 'Too generic, call Ana Lopez at 612-555-0199' },
    });
    expect(res.statusCode).toBe(200);
    // Change of mind replaces the rating rather than adding a second one.
    await app.inject({
      method: 'POST',
      url: `/api/turns/${t.id}/rating`,
      payload: { rating: 'helpful' },
    });
    const rows = await edb.db.select().from(turnRatings).where(eq(turnRatings.turnId, t.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rating: 'helpful',
      promptVersion: 'v3_test',
      modelUsed: 'claude-haiku-4-5',
    });

    const detail = await app.inject({ url: `/api/sessions/${s.id}` });
    expect(detail.json<{ turns: { rating?: string }[] }>().turns[0]!.rating).toBe('helpful');
  });

  it("cannot rate someone else's turn", async () => {
    const other = await insertLeader(config, edb.db);
    const s = (await edb.db.insert(sessions).values({ userId: other }).returning())[0]!;
    const t = (
      await edb.db
        .insert(turns)
        .values({ sessionId: s.id, userId: other, userMessage: 'x' })
        .returning()
    )[0]!;
    const app = await buildRealApp(config, edb.db);
    const res = await app.inject({
      method: 'POST',
      url: `/api/turns/${t.id}/rating`,
      payload: { rating: 'helpful' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('is a 404 when FEATURE_RATINGS is off', async () => {
    const app = await buildRealApp(demoTestConfig({ features: {} }), edb.db);
    const res = await app.inject({
      method: 'POST',
      url: '/api/turns/00000000-0000-4000-8000-000000000001/rating',
      payload: { rating: 'helpful' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('P2.6 weekly nudge (opt-in)', () => {
  it('opting in schedules Monday 09:00 local; it sends one daily-library prompt and re-arms for next week', async () => {
    clearDemoOutboxForTests();
    setClockForTests(new Date('2026-11-18T18:00:00.000Z')); // Wednesday
    const app = await buildRealApp(config, edb.db);
    await app.inject({
      method: 'PATCH',
      url: '/api/preferences',
      payload: { weeklyNudgeOptIn: true },
    });
    const job = (
      await edb.db
        .select()
        .from(backgroundJobs)
        .where(eq(backgroundJobs.dedupeKey, `nudge:${current}`))
    )[0]!;
    expect(job.runAfter.toISOString()).toBe('2026-11-23T09:00:00.000Z'); // Monday 09:00 UTC (leader tz UTC)

    const monday = new Date('2026-11-23T09:05:00.000Z');
    setClockForTests(monday);
    await runDueJobs(edb.db, buildJobHandlers(config, edb.db), { now: monday, quiet: true });
    const sent = demoOutbox();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('A question for your week');
    expect(dailyPromptsV1.prompts.some((p) => sent[0]!.text.includes(p.body))).toBe(true);
    const again = (
      await edb.db
        .select()
        .from(backgroundJobs)
        .where(eq(backgroundJobs.dedupeKey, `nudge:${current}`))
    )[0]!;
    expect(again.status).toBe('pending');
    expect(again.runAfter.toISOString()).toBe('2026-11-30T09:00:00.000Z');
  });

  it('nextMondayMorning respects the timezone', () => {
    expect(
      nextMondayMorning(new Date('2026-11-18T18:00:00.000Z'), 'America/Chicago').toISOString(),
    ).toBe('2026-11-23T15:00:00.000Z');
  });
});
