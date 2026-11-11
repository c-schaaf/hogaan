/**
 * P1 "Done when": a second session, days later, opens with the coach already
 * knowing the leader's role, team, and last open loop — and a test proves
 * no email, phone number, or surname reaches a model call (D2).
 *
 * Real routes + real embedded Postgres + the real job runner. Only the
 * Anthropic client is stubbed, and every request it receives is inspected.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildJobHandlers } from '../../src/jobs/handlers.js';
import { runDueJobs } from '../../src/jobs/runner.js';
import { promptTemplatesV2Unified, publishLibraryVersion } from '../../src/libraries/index.js';
import { resetResolverForTests } from '../../src/libraries/resolver.js';
import { resetAnthropicClientForTests } from '../../src/shared/llm/anthropic.js';
import { resetChatBreakersForTests } from '../../src/shared/llm/chat.js';
import { resetEncryptionCache } from '../../src/shared/db/encryption.js';
import type { EmbeddedDb } from '../../src/shared/db/embedded.js';
import { getBrief } from '../../src/leader-context/store.js';
import { buildRealApp, insertLeader } from '../helpers/app.js';
import { demoTestConfig, embeddedTestDb } from '../helpers/embedded.js';
import { installModelStub, type ModelStub } from '../helpers/model-stub.js';

let current = '';
vi.mock('../../src/web-api/supabase-session.js', () => ({
  requireSupabaseSession: vi.fn(() => Promise.resolve({ userId: current })),
}));

const config = demoTestConfig({ demoMode: false, anthropicApiKey: 'sk-test-stub' });
let edb: EmbeddedDb;
let stub: ModelStub;

beforeAll(async () => {
  resetEncryptionCache();
  resetResolverForTests();
  resetChatBreakersForTests();
  edb = await embeddedTestDb();
  await publishLibraryVersion(edb.db, {
    libraryName: 'prompt_templates',
    version: 'test',
    payload: promptTemplatesV2Unified,
    publishedBy: 'test',
    makeActive: true,
  });
  current = await insertLeader(config, edb.db, 'Amina Farah');
  stub = installModelStub();
}, 60_000);

afterAll(async () => {
  resetAnthropicClientForTests();
  await edb.close();
});

const SECRET_EMAIL = 'sarah.johnson@cityhousing.org';
const SECRET_PHONE = '+1 (612) 555-0199';

describe('P1 done-when: context carries into a later session', () => {
  it('session 1 -> background brief update -> session 2 prompt knows role, team, open loop', async () => {
    const app = await buildRealApp(config, edb.db);

    // ---- Session 1 --------------------------------------------------
    const first = await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: {
        message: `I'm the program director at a housing nonprofit and I manage six people. My director Sarah Johnson (${SECRET_EMAIL}, ${SECRET_PHONE}) says no to new hires. I want to ask for one more hire, Farah family style.`,
      },
    });
    expect(first.statusCode).toBe(200);

    // The background model returns the brief (what Opus 5.5 would produce).
    stub.setJson({
      profileFields: {
        title: 'Program director',
        teamShape: 'six direct reports',
        orgType: 'nonprofit',
      },
      profile: ['Leads at a housing nonprofit'],
      goals: ['Ask the director for one more hire (Accountability)'],
      notes: ['Open loop: ask director Sarah Johnson for headcount; reach her at ' + SECRET_EMAIL],
      moments: [],
    });

    // Job was enqueued by the turn; run it now (as the runner would later).
    const ran = await runDueJobs(edb.db, buildJobHandlers(config, edb.db), {
      now: new Date(Date.now() + 60 * 60_000),
      quiet: true,
    });
    expect(ran).toBe(1);

    const brief = await getBrief(config, edb.db, current);
    expect(brief.profileFields.title).toBe('Program director');
    const stored = JSON.stringify(brief);
    expect(stored).not.toContain(SECRET_EMAIL);
    expect(stored).not.toContain('Johnson');

    // ---- Session 2, "days later": no sessionId -> brand-new session ----
    const second = await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'Back again. How should I open tomorrow?' },
    });
    expect(second.statusCode).toBe(200);
    const lastStream = [...stub.calls].reverse().find((c) => c['stream'] === true)!;
    const system = JSON.stringify(lastStream['system']);
    expect(system).toContain('What you know about this leader');
    expect(system).toContain('Program director');
    expect(system).toContain('six direct reports');
    expect(system).toContain('Open loop');
    // Only the brief carried it: session 2 has no prior turns in messages[].
    expect((lastStream['messages'] as unknown[]).length).toBe(1);
  });

  it('D2: no email, phone number or surname reached ANY model call', () => {
    expect(stub.calls.length).toBeGreaterThanOrEqual(3); // 2 chat turns + 1 background
    for (const call of stub.calls) {
      const wire = JSON.stringify({ system: call['system'], messages: call['messages'] });
      expect(wire).not.toContain(SECRET_EMAIL);
      expect(wire).not.toMatch(/555[-\s.]?0199/);
      expect(wire).not.toContain('Johnson');
      // The leader's own surname (from her account name) is stripped too.
      expect(wire).not.toContain('Farah');
    }
  });

  it('the static library block is sent with a cache breakpoint; per-leader text comes after it', () => {
    const call = [...stub.calls].reverse().find((c) => c['stream'] === true)!;
    const system = call['system'] as { text: string; cache_control?: unknown }[];
    expect(Array.isArray(system)).toBe(true);
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(system[0]!.text).not.toContain('What you know about this leader');
    expect(system[1]!.text).toContain('What you know about this leader');
  });

  it('private sessions never enqueue or write a brief update', async () => {
    const app = await buildRealApp(config, edb.db);
    // Drain anything earlier tests queued.
    await runDueJobs(edb.db, buildJobHandlers(config, edb.db), {
      now: new Date(Date.now() + 60 * 60_000),
      quiet: true,
    });
    const before = (await getBrief(config, edb.db, current)).version;
    await app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      payload: { message: 'Private: I am thinking of quitting.', private: true },
    });
    const ran = await runDueJobs(edb.db, buildJobHandlers(config, edb.db), {
      now: new Date(Date.now() + 60 * 60_000),
      quiet: true,
    });
    expect(ran).toBe(0);
    expect((await getBrief(config, edb.db, current)).version).toBe(before);
  });
});
