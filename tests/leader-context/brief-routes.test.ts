import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EmbeddedDb } from '../../src/shared/db/embedded.js';
import { resetEncryptionCache } from '../../src/shared/db/encryption.js';
import { leaderBriefs } from '../../src/shared/db/schema/leader-briefs.js';
import { mergeBrief } from '../../src/leader-context/updater.js';
import { emptyBrief } from '../../src/leader-context/types.js';
import { renderBriefBlock } from '../../src/leader-context/render.js';
import { buildRealApp, insertLeader } from '../helpers/app.js';
import { demoTestConfig, embeddedTestDb } from '../helpers/embedded.js';
import type { LeaderBrief } from '../../src/leader-context/types.js';

let current = '';
vi.mock('../../src/web-api/supabase-session.js', () => ({
  requireSupabaseSession: vi.fn(() => Promise.resolve({ userId: current })),
}));

const config = demoTestConfig();
let edb: EmbeddedDb;
beforeAll(async () => {
  resetEncryptionCache();
  edb = await embeddedTestDb();
  current = await insertLeader(config, edb.db);
}, 60_000);
afterAll(async () => edb.close());

describe('P1.2 / P1.3 — "What Hogaan knows about you" routes', () => {
  it('starts empty, then the leader can add, edit, delete lines and fields', async () => {
    const app = await buildRealApp(config, edb.db);
    let b = (await app.inject({ url: '/api/brief' })).json<LeaderBrief>();
    expect(b.notes).toEqual([]);

    b = (
      await app.inject({
        method: 'POST',
        url: '/api/brief/lines',
        payload: { doc: 'goals', text: 'Get better at delegating to Omar Abdi' },
      })
    ).json<LeaderBrief>();
    expect(b.goals[0]!.text).toBe('Get better at delegating to Omar'); // surname filtered
    expect(b.goals[0]!.source).toBe('leader');
    const id = b.goals[0]!.id;

    b = (
      await app.inject({
        method: 'PATCH',
        url: `/api/brief/lines/${id}`,
        payload: { text: 'Delegate more' },
      })
    ).json<LeaderBrief>();
    expect(b.goals[0]!.text).toBe('Delegate more');

    b = (
      await app.inject({
        method: 'PATCH',
        url: '/api/brief/fields',
        payload: { title: 'Team lead', teamShape: '4 engineers' },
      })
    ).json<LeaderBrief>();
    expect(b.profileFields).toEqual({ title: 'Team lead', teamShape: '4 engineers' });

    b = (
      await app.inject({ method: 'PATCH', url: '/api/brief/fields', payload: { title: '' } })
    ).json<LeaderBrief>();
    expect(b.profileFields).toEqual({ teamShape: '4 engineers' });

    b = (await app.inject({ method: 'DELETE', url: `/api/brief/lines/${id}` })).json<LeaderBrief>();
    expect(b.goals).toEqual([]);
  });

  it('stores ciphertext only', async () => {
    const rows = await edb.db.select().from(leaderBriefs);
    const raw = JSON.stringify(rows);
    expect(raw).not.toContain('4 engineers');
  });

  it('"delete everything" removes the brief', async () => {
    const app = await buildRealApp(config, edb.db);
    await app.inject({
      method: 'POST',
      url: '/api/brief/lines',
      payload: { doc: 'notes', text: 'x note' },
    });
    expect((await app.inject({ method: 'DELETE', url: '/api/brief' })).statusCode).toBe(200);
    const b = (await app.inject({ url: '/api/brief' })).json<LeaderBrief>();
    expect(b.notes).toEqual([]);
    expect(b.profileFields).toEqual({});
  });

  it('rejects bad input', async () => {
    const app = await buildRealApp(config, edb.db);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/brief/lines',
          payload: { doc: 'secrets', text: 'x' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/brief/lines/not-a-uuid',
          payload: { text: 'x' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('every brief route is a 404 when FEATURE_LEADER_BRIEF is off', async () => {
    const off = demoTestConfig({ features: {} });
    const app = await buildRealApp(off, edb.db);
    for (const [method, url] of [
      ['GET', '/api/brief'],
      ['PATCH', '/api/brief/fields'],
      ['POST', '/api/brief/lines'],
      ['DELETE', '/api/brief'],
    ] as const) {
      const res = await app.inject({ method, url, payload: {} });
      expect(res.statusCode).toBe(404);
    }
  });
});

describe('P1.1 merge rules', () => {
  const base = (): LeaderBrief => {
    const b = emptyBrief();
    b.profileFields = { title: 'Director (set by leader)' };
    b.notes = [
      { id: 'a', text: 'Leader wrote this', source: 'leader', updatedAt: '' },
      { id: 'b', text: 'Old model note', source: 'conversation', updatedAt: '' },
      { id: 'c', text: 'Kept model note', source: 'conversation', updatedAt: '' },
    ];
    return b;
  };

  it('never overwrites fields or leader lines; replaces model lines; keeps ids for unchanged text', () => {
    const out = mergeBrief(base(), {
      profileFields: { title: 'Manager', teamShape: 'six people' },
      profile: [],
      goals: [],
      notes: ['Kept model note', 'New note with Ana Lopez'],
      moments: [],
    });
    expect(out.profileFields).toEqual({
      title: 'Director (set by leader)',
      teamShape: 'six people',
    });
    expect(out.notes.map((l) => l.text)).toEqual([
      'Leader wrote this',
      'Kept model note',
      'New note with Ana',
    ]);
    expect(out.notes[1]!.id).toBe('c');
  });

  it('renders a prompt block with the brief, and nothing for an empty brief', () => {
    expect(renderBriefBlock(emptyBrief())).toBe('');
    const text = renderBriefBlock(base());
    expect(text).toContain('## What you know about this leader');
    expect(text).toContain('Role: Director (set by leader)');
    expect(text).toContain('Leader wrote this');
  });
});
