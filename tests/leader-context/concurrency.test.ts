import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendLine, deleteBrief, getBrief, saveBrief } from '../../src/leader-context/store.js';
import { emptyBrief } from '../../src/leader-context/types.js';
import { createMoment } from '../../src/moments/store.js';
import type { EmbeddedDb } from '../../src/shared/db/embedded.js';
import { resetEncryptionCache } from '../../src/shared/db/encryption.js';
import { insertLeader } from '../helpers/app.js';
import { demoTestConfig, embeddedTestDb } from '../helpers/embedded.js';

const config = demoTestConfig({ features: { ...demoTestConfig().features, followUpEmail: false } });
let edb: EmbeddedDb;
beforeAll(async () => {
  resetEncryptionCache();
  edb = await embeddedTestDb();
}, 60_000);
afterAll(async () => edb.close());

describe('review fixes: the leader always wins over a slow background update', () => {
  it('a background write based on an old version is refused', async () => {
    const id = await insertLeader(config, edb.db);
    await appendLine(config, edb.db, id, 'notes', 'Sensitive line', 'conversation');
    const readByJob = await getBrief(config, edb.db, id); // job reads…
    await deleteBrief(config, edb.db, id); // …leader deletes everything meanwhile…
    const stale = { ...readByJob, notes: [...readByJob.notes] };
    const ok = await saveBrief(config, edb.db, id, stale, {
      updatedBy: 'model:test',
      expectedVersion: readByJob.version,
    });
    expect(ok).toBe(false); // …and the job's write is refused
    const now = await getBrief(config, edb.db, id);
    expect(now.notes).toEqual([]);
  });

  it('a first-ever background write loses to a leader write that happened first', async () => {
    const id = await insertLeader(config, edb.db);
    await appendLine(config, edb.db, id, 'goals', 'Leader goal', 'leader');
    const ok = await saveBrief(config, edb.db, id, emptyBrief(), {
      updatedBy: 'model:test',
      expectedVersion: 0,
    });
    expect(ok).toBe(false);
    expect((await getBrief(config, edb.db, id)).goals[0]!.text).toBe('Leader goal');
  });

  it('the same moment on a different day is a new moment (recurring 1:1s)', async () => {
    const id = await insertLeader(config, edb.db);
    const a = await createMoment(config, edb.db, id, {
      what: '1:1 with my director',
      source: 'leader',
      happensAt: new Date('2026-11-12T15:00:00Z'),
    });
    const b = await createMoment(config, edb.db, id, {
      what: '1:1 with my director',
      source: 'leader',
      happensAt: new Date('2026-11-19T15:00:00Z'),
    });
    const dup = await createMoment(config, edb.db, id, {
      what: '1:1 with my director',
      source: 'leader',
      happensAt: new Date('2026-11-19T16:00:00Z'),
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(dup).toBeNull();
  });
});
