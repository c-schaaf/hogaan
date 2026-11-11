/**
 * P2 "Done when": a leader who prepares for a Thursday conversation gets one
 * follow-up on Friday, can reflect in two minutes, and the next session's
 * coaching refers to what happened.
 *
 * Real routes, real embedded Postgres, real job runner and email guards.
 * The model client is stubbed; email is captured (demo-mode transport).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildJobHandlers } from '../../src/jobs/handlers.js';
import { runDueJobs } from '../../src/jobs/runner.js';
import { promptTemplatesV2Unified, publishLibraryVersion } from '../../src/libraries/index.js';
import { resetResolverForTests } from '../../src/libraries/resolver.js';
import { setClockForTests } from '../../src/shared/clock.js';
import type { EmbeddedDb } from '../../src/shared/db/embedded.js';
import { resetEncryptionCache } from '../../src/shared/db/encryption.js';
import { emailSends } from '../../src/shared/db/schema/moments.js';
import { users } from '../../src/shared/db/schema/users.js';
import { clearDemoOutboxForTests, demoOutbox } from '../../src/shared/email/proactive.js';
import { resetAnthropicClientForTests } from '../../src/shared/llm/anthropic.js';
import { resetChatBreakersForTests } from '../../src/shared/llm/chat.js';
import type { MomentView } from '../../src/moments/store.js';
import { buildRealApp, insertLeader } from '../helpers/app.js';
import { demoTestConfig, embeddedTestDb } from '../helpers/embedded.js';
import { installModelStub, type ModelStub } from '../helpers/model-stub.js';

let current = '';
vi.mock('../../src/web-api/supabase-session.js', () => ({
  requireSupabaseSession: vi.fn(() => Promise.resolve({ userId: current })),
}));

// Demo-mode email capture, but a (stubbed) real model.
const config = demoTestConfig({ anthropicApiKey: 'sk-test-stub' });
let edb: EmbeddedDb;
let stub: ModelStub;

// Leader in Chicago. Thursday 2026-11-19 14:00 CST = 20:00Z.
const THURSDAY_2PM = '2026-11-19T20:00:00.000Z';
const FRIDAY_9AM_CHICAGO = Date.parse('2026-11-20T15:00:00.000Z');

beforeAll(async () => {
  resetEncryptionCache();
  resetResolverForTests();
  resetChatBreakersForTests();
  clearDemoOutboxForTests();
  edb = await embeddedTestDb();
  await publishLibraryVersion(edb.db, {
    libraryName: 'prompt_templates',
    version: 'test',
    payload: promptTemplatesV2Unified,
    publishedBy: 'test',
    makeActive: true,
  });
  current = await insertLeader(config, edb.db, 'Amina Farah');
  await edb.db.update(users).set({ timezone: 'America/Chicago' }).where(eq(users.id, current));
  stub = installModelStub();
}, 60_000);

afterAll(async () => {
  setClockForTests(null);
  resetAnthropicClientForTests();
  await edb.close();
});

const handlers = () => buildJobHandlers(config, edb.db);

describe('P2 done-when: prepare -> one follow-up -> reflect -> next session knows', () => {
  let momentId = '';

  it('the leader opts in to follow-up emails', async () => {
    const app = await buildRealApp(config, edb.db);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/preferences',
      payload: { followupEmailOptIn: true },
    });
    expect(res.json()).toMatchObject({ followupEmailOptIn: true, weeklyNudgeOptIn: false });
  });

  it('preparing in a session creates a Thursday moment via the background update', async () => {
    setClockForTests(new Date('2026-11-17T16:00:00.000Z')); // Tuesday
    const app = await buildRealApp(config, edb.db);
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: {
        message:
          'Help me prepare for my conversation with my director on Thursday at 2pm about headcount.',
      },
    });
    stub.setJson({
      profileFields: {},
      profile: [],
      goals: ['Ask for one more hire'],
      notes: [],
      moments: [{ what: 'Headcount conversation', withWhom: 'their director', when: THURSDAY_2PM }],
    });
    await runDueJobs(edb.db, handlers(), {
      now: new Date('2026-11-17T17:00:00.000Z'),
      quiet: true,
    });
    const list = (await app.inject({ url: '/api/moments' })).json<{ moments: MomentView[] }>()
      .moments;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      what: 'Headcount conversation',
      withWhom: 'their director',
      happensAt: THURSDAY_2PM,
    });
    momentId = list[0]!.id;
  });

  it('nothing is sent before Friday morning', async () => {
    setClockForTests(new Date('2026-11-19T23:00:00.000Z'));
    const ran = await runDueJobs(edb.db, handlers(), {
      now: new Date('2026-11-19T23:00:00.000Z'),
      quiet: true,
    });
    expect(ran).toBe(0);
    expect(demoOutbox()).toHaveLength(0);
  });

  it("exactly one follow-up goes out Friday 09:00 in the leader's timezone, with an unsubscribe link", async () => {
    const friday = new Date(FRIDAY_9AM_CHICAGO + 5 * 60_000);
    setClockForTests(friday);
    await runDueJobs(edb.db, handlers(), { now: friday, quiet: true });
    // Running again (or a duplicate job) must not send a second email.
    await runDueJobs(edb.db, handlers(), {
      now: new Date(friday.getTime() + 3600_000),
      quiet: true,
    });
    const sent = demoOutbox();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('How did it go?');
    expect(sent[0]!.text).toContain(`/reflect/${momentId}`);
    expect(sent[0]!.text).toMatch(/\/api\/email\/unsubscribe\?u=[0-9a-f-]+&t=/);
    expect(sent[0]!.text).not.toContain('Headcount'); // the inbox never sees what it was about
    const ledger = await edb.db.select().from(emailSends).where(eq(emailSends.userId, current));
    expect(ledger).toHaveLength(1);
  });

  it('the two-minute reflection records the outcome and writes a note', async () => {
    const app = await buildRealApp(config, edb.db);
    const res = await app.inject({
      method: 'POST',
      url: `/api/moments/${momentId}/outcome`,
      payload: {
        howItWent: 'mixed',
        differently: 'Bring the budget numbers first',
        confidenceBefore: 2,
        confidenceAfter: 4,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<MomentView>()).toMatchObject({
      status: 'reflected',
      outcome: { howItWent: 'mixed' },
    });
  });

  it("the next session's prompt refers to what happened", async () => {
    const app = await buildRealApp(config, edb.db);
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'Hi again.' },
    });
    const last = [...stub.calls].reverse().find((c) => c['stream'] === true)!;
    const system = JSON.stringify(last['system']);
    expect(system).toContain('Reflection on \\"Headcount conversation\\"');
    expect(system).toContain('was mixed');
    expect(system).toContain('Bring the budget numbers first');
  });
});
