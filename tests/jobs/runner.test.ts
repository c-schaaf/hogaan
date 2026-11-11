import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { enqueueJob, runDueJobs } from '../../src/jobs/runner.js';
import type { EmbeddedDb } from '../../src/shared/db/embedded.js';
import { backgroundJobs } from '../../src/shared/db/schema/background-jobs.js';
import { embeddedTestDb } from '../helpers/embedded.js';

let edb: EmbeddedDb;
beforeAll(async () => {
  edb = await embeddedTestDb();
}, 60_000);
afterAll(async () => edb.close());

const later = () => new Date(Date.now() + 24 * 3600_000);

describe('P2.5 background job runner', () => {
  it("'once' enqueue is idempotent: same key runs exactly once", async () => {
    let runs = 0;
    await enqueueJob(edb.db, { kind: 'k', dedupeKey: 'once-1' });
    await enqueueJob(edb.db, { kind: 'k', dedupeKey: 'once-1' });
    await runDueJobs(edb.db, { k: () => Promise.resolve(void runs++) }, { quiet: true });
    await enqueueJob(edb.db, { kind: 'k', dedupeKey: 'once-1' });
    await runDueJobs(edb.db, { k: () => Promise.resolve(void runs++) }, { quiet: true });
    expect(runs).toBe(1);
  });

  it("'replace' re-arms a finished key with the new run time (debounce)", async () => {
    let runs = 0;
    const h = { k2: () => Promise.resolve(void runs++) };
    await enqueueJob(edb.db, { kind: 'k2', dedupeKey: 'rep-1', mode: 'replace' });
    await runDueJobs(edb.db, h, { quiet: true });
    await enqueueJob(edb.db, {
      kind: 'k2',
      dedupeKey: 'rep-1',
      mode: 'replace',
      runAfter: later(),
    });
    expect(await runDueJobs(edb.db, h, { quiet: true })).toBe(0); // not due yet
    await runDueJobs(edb.db, h, { quiet: true, now: new Date(Date.now() + 25 * 3600_000) });
    expect(runs).toBe(2);
  });

  it('a failing handler is retried with backoff, then marked failed — never thrown', async () => {
    await enqueueJob(edb.db, { kind: 'boom', dedupeKey: 'fail-1' });
    const h = { boom: () => Promise.reject(new Error('provider down')) };
    let now = Date.now();
    for (let i = 0; i < 3; i++) {
      await expect(
        runDueJobs(edb.db, h, { quiet: true, now: new Date(now) }),
      ).resolves.toBeGreaterThanOrEqual(0);
      now += 24 * 3600_000;
    }
    const row = (
      await edb.db.select().from(backgroundJobs).where(eq(backgroundJobs.dedupeKey, 'fail-1'))
    )[0]!;
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(3);
    expect(row.lastError).toContain('provider down');
  });

  it('an unknown job kind fails safely', async () => {
    await enqueueJob(edb.db, { kind: 'nobody-handles-this', dedupeKey: 'unk-1' });
    await expect(runDueJobs(edb.db, {}, { quiet: true })).resolves.toBe(1);
  });
});
