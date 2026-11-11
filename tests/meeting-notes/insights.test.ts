import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EmbeddedDb } from '../../src/shared/db/embedded.js';
import { resetEncryptionCache } from '../../src/shared/db/encryption.js';
import { resetAnthropicClientForTests } from '../../src/shared/llm/anthropic.js';
import { buildRealApp, insertLeader } from '../helpers/app.js';
import { demoTestConfig, embeddedTestDb } from '../helpers/embedded.js';
import { installModelStub, type ModelStub } from '../helpers/model-stub.js';

let current = '';
vi.mock('../../src/web-api/supabase-session.js', () => ({
  requireSupabaseSession: vi.fn(() => Promise.resolve({ userId: current })),
}));

const config = demoTestConfig({
  demoMode: false,
  anthropicApiKey: 'sk-test-stub',
  features: { ...demoTestConfig().features, billing: false },
});
let edb: EmbeddedDb;
let stub: ModelStub;
beforeAll(async () => {
  resetEncryptionCache();
  edb = await embeddedTestDb();
  current = await insertLeader(config, edb.db);
  stub = installModelStub();
}, 60_000);
afterAll(async () => {
  resetAnthropicClientForTests();
  await edb.close();
});

const MARKER = 'ZEBRA-QUARTZ-7781';
const NOTES = `Board meeting notes ${MARKER}. Chair Mary Okonkwo (mary@board.org, 612-555-0123) asked about the deficit. I pushed back on cutting the youth program. We agreed I will bring a revised budget next month.`;

describe('P6.2 meeting notes -> insights, transcript discarded', () => {
  it('returns insights, strips names/contacts before the model, stores nothing', async () => {
    stub.setJson({
      insights: [
        'Held firm on protecting the youth program when a board member pushed for cuts',
        'Open loop: revised budget for the board next month, Mary Okonkwo wants it',
      ],
    });
    const app = await buildRealApp(config, edb.db);
    const res = await app.inject({
      method: 'POST',
      url: '/api/meeting-notes/insights',
      payload: { notes: NOTES },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ insights: string[]; stored: boolean }>();
    expect(body.stored).toBe(false);
    expect(body.insights).toHaveLength(2);
    expect(body.insights.join(' ')).not.toContain('Okonkwo');

    const sent = JSON.stringify(stub.calls.at(-1)!['messages']);
    expect(sent).toContain(MARKER); // the model saw the notes…
    expect(sent).not.toContain('Okonkwo'); // …without the surname
    expect(sent).not.toContain('mary@board.org');
    expect(sent).not.toMatch(/555-0123/);

    // …and no table anywhere holds them.
    const tables = await edb.pg.query<{ s: string; t: string }>(
      "SELECT table_schema AS s, table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
    );
    for (const { s, t } of tables.rows) {
      const hit = await edb.pg.query(
        `SELECT 1 FROM "${s}"."${t}" x WHERE row_to_json(x)::text LIKE $1 LIMIT 1`,
        [`%${MARKER}%`],
      );
      expect(hit.rows, `${t} must not contain the pasted notes`).toHaveLength(0);
    }
  });

  it('the leader keeps only what they choose (through the normal brief API)', async () => {
    const app = await buildRealApp(config, edb.db);
    await app.inject({
      method: 'POST',
      url: '/api/brief/lines',
      payload: { doc: 'notes', text: 'Held firm on protecting the youth program' },
    });
    const brief = (await app.inject({ url: '/api/brief' })).json<{ notes: { text: string }[] }>();
    expect(brief.notes.map((n) => n.text)).toEqual(['Held firm on protecting the youth program']);
  });

  it('is a 404 when the flag is off and needs the connections capability when billing is on', async () => {
    const off = await buildRealApp(demoTestConfig({ features: {} }), edb.db);
    expect(
      (
        await off.inject({
          method: 'POST',
          url: '/api/meeting-notes/insights',
          payload: { notes: NOTES },
        })
      ).statusCode,
    ).toBe(404);
    const billed = await buildRealApp(demoTestConfig(), edb.db);
    expect(
      (
        await billed.inject({
          method: 'POST',
          url: '/api/meeting-notes/insights',
          payload: { notes: NOTES },
        })
      ).statusCode,
    ).toBe(402);
  });
});
