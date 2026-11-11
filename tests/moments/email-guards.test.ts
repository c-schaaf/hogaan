import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { setClockForTests } from '../../src/shared/clock.js';
import type { EmbeddedDb } from '../../src/shared/db/embedded.js';
import { resetEncryptionCache } from '../../src/shared/db/encryption.js';
import { users } from '../../src/shared/db/schema/users.js';
import {
  clearDemoOutboxForTests,
  followUpTime,
  getPrefs,
  inQuietHours,
  sendProactiveEmail,
  setPrefs,
  unsubscribeUrl,
} from '../../src/shared/email/proactive.js';
import { buildRealApp, insertLeader } from '../helpers/app.js';
import { demoTestConfig, embeddedTestDb } from '../helpers/embedded.js';

let current = '';
vi.mock('../../src/web-api/supabase-session.js', () => ({
  requireSupabaseSession: vi.fn(() => Promise.resolve({ userId: current })),
}));

const demo = demoTestConfig();
let edb: EmbeddedDb;
beforeAll(async () => {
  resetEncryptionCache();
  edb = await embeddedTestDb();
}, 60_000);
afterAll(async () => edb.close());
afterEach(() => {
  setClockForTests(null);
  vi.unstubAllGlobals();
});

async function leader(tz = 'America/Chicago'): Promise<string> {
  const id = await insertLeader(demo, edb.db);
  await edb.db.update(users).set({ timezone: tz }).where(eq(users.id, id));
  return id;
}
const noonChicago = new Date('2026-11-18T18:00:00.000Z');
const mail = (userId: string, key: string, now = noonChicago) => ({
  userId,
  kind: 'followup' as const,
  idempotencyKey: key,
  subject: 's',
  text: 't',
  now,
});

describe('D4 proactive email guards', () => {
  it('sends nothing unless the leader opted in', async () => {
    const id = await leader();
    expect((await sendProactiveEmail(demo, edb.db, mail(id, 'a1'))).outcome).toBe('not_opted_in');
  });

  it('caps at 2 per rolling 7 days and says when to retry', async () => {
    const id = await leader();
    await setPrefs(edb.db, id, { followupEmailOptIn: true });
    expect((await sendProactiveEmail(demo, edb.db, mail(id, 'c1'))).outcome).toBe('captured');
    expect((await sendProactiveEmail(demo, edb.db, mail(id, 'c2'))).outcome).toBe('captured');
    const third = await sendProactiveEmail(demo, edb.db, mail(id, 'c3'));
    expect(third.outcome).toBe('capped');
    if (third.outcome === 'capped') {
      expect(third.retryAt.getTime()).toBeGreaterThan(noonChicago.getTime() + 6 * 24 * 3600_000);
    }
  });

  it('a repeated idempotency key is a no-op', async () => {
    const id = await leader();
    await setPrefs(edb.db, id, { followupEmailOptIn: true });
    expect((await sendProactiveEmail(demo, edb.db, mail(id, 'd1'))).outcome).toBe('captured');
    expect((await sendProactiveEmail(demo, edb.db, mail(id, 'd1'))).outcome).toBe('duplicate');
  });

  it("respects quiet hours in the leader's timezone", async () => {
    const id = await leader('Africa/Nairobi');
    await setPrefs(edb.db, id, { followupEmailOptIn: true });
    const r = await sendProactiveEmail(
      demo,
      edb.db,
      mail(id, 'q1', new Date('2026-11-18T20:00:00.000Z')),
    ); // 23:00 Nairobi
    expect(r.outcome).toBe('quiet_hours');
    if (r.outcome === 'quiet_hours')
      expect(r.retryAt.toISOString()).toBe('2026-11-19T05:00:00.000Z'); // 08:00 Nairobi
    expect(inQuietHours(22, 21, 8)).toBe(true);
    expect(inQuietHours(7, 21, 8)).toBe(true);
    expect(inQuietHours(12, 21, 8)).toBe(false);
  });

  it('follow-up time is the next local 09:00 after the moment', () => {
    expect(
      followUpTime(new Date('2026-11-19T20:00:00.000Z'), 'America/Chicago').toISOString(),
    ).toBe('2026-11-20T15:00:00.000Z');
  });

  it('the signed unsubscribe link turns everything off; a forged one does not', async () => {
    const id = await leader();
    current = id;
    await setPrefs(edb.db, id, { followupEmailOptIn: true, weeklyNudgeOptIn: true });
    const app = await buildRealApp(demo, edb.db);
    const forged = await app.inject({ url: `/api/email/unsubscribe?u=${id}&t=nope` });
    expect(forged.statusCode).toBe(400);
    expect((await getPrefs(edb.db, id)).followupEmailOptIn).toBe(true);
    const url = new URL(unsubscribeUrl(demo, id));
    // A link scanner opening the link (GET) must NOT unsubscribe.
    const view = await app.inject({ url: url.pathname + url.search });
    expect(view.statusCode).toBe(200);
    expect(view.body).toContain('<form method="post"');
    expect((await getPrefs(edb.db, id)).followupEmailOptIn).toBe(true);
    // Gmail/Yahoo one-click (RFC 8058): form-encoded POST.
    const ok = await app.inject({
      method: 'POST',
      url: url.pathname + url.search,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    });
    expect(ok.statusCode).toBe(200);
    const p = await getPrefs(edb.db, id);
    expect(p).toMatchObject({
      followupEmailOptIn: false,
      weeklyNudgeOptIn: false,
      unsubscribedAll: true,
    });
    expect((await sendProactiveEmail(demo, edb.db, mail(id, 'u1'))).outcome).toBe('not_opted_in');
  });

  it('outside demo mode it calls Resend once, with Idempotency-Key and List-Unsubscribe', async () => {
    const real = demoTestConfig({
      demoMode: false,
      resendApiKey: 're_test',
      resendFromEmail: 'coach@example.com',
    });
    const id = await leader();
    await setPrefs(edb.db, id, { followupEmailOptIn: true });
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    clearDemoOutboxForTests();
    const r = await sendProactiveEmail(real, edb.db, mail(id, 'r1'));
    expect(r).toEqual({ outcome: 'sent', messageId: 'msg_1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('r1');
    const body = JSON.parse(init.body as string) as { headers: Record<string, string> };
    expect(body.headers['List-Unsubscribe']).toMatch(/^<http.*\/api\/email\/unsubscribe\?/);
  });
});
