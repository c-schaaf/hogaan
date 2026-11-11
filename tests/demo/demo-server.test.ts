import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { startDemoServer, type DemoServer } from '../../src/demo/server.js';
import { auditLog } from '../../src/shared/db/schema/audit-log.js';
import { DEMO_ACCESS_TOKEN } from '../../src/web-api/supabase-session.js';

const saved = { ...process.env };
let demo: DemoServer;
const auth = { authorization: `Bearer ${DEMO_ACCESS_TOKEN}` };

beforeAll(async () => {
  process.env = { NODE_ENV: 'test', PORT: '3999', LOG_LEVEL: 'error' };
  demo = await startDemoServer({ listen: false, webDistDir: '/nonexistent' });
}, 60_000);
afterAll(async () => {
  await demo?.close();
  process.env = { ...saved };
});

describe('demo server (embedded DB, demo sign-in, scripted coach)', () => {
  it('serves the seeded sample leader to the demo token', async () => {
    const res = await demo.app.inject({ url: '/api/profile', headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ fullName: 'Amina Farah', onboarded: true });
  });

  it('rejects any other token', async () => {
    const res = await demo.app.inject({
      url: '/api/profile',
      headers: { authorization: 'Bearer something-else' },
    });
    expect(res.statusCode).toBe(401);
    const none = await demo.app.inject({ url: '/api/profile' });
    expect(none.statusCode).toBe(401);
  });

  it('still writes an audit row for every demo request (fail-closed contract kept)', async () => {
    const before = await demo.embedded.db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.targetEndEvent, 'E1_SessionsList'));
    await demo.app.inject({ url: '/api/sessions', headers: auth });
    const after = await demo.embedded.db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.targetEndEvent, 'E1_SessionsList'));
    expect(after.length).toBe(before.length + 1);
  });

  it('lists the seeded past sessions', async () => {
    const res = await demo.app.inject({ url: '/api/sessions', headers: auth });
    const titles = res.json<{ sessions: { title: string }[] }>().sessions.map((s) => s.title);
    expect(titles).toContain('Giving hard feedback to a senior analyst');
  });

  it('streams a scripted coach reply and persists the turn', async () => {
    const res = await demo.app.inject({
      method: 'POST',
      url: '/api/chat/turn/stream',
      headers: auth,
      payload: { message: 'I have a tough conversation with my director next week' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('event: start');
    const text = [...res.body.matchAll(/event: delta\ndata: (.*)\n/g)]
      .map((m) => (JSON.parse(m[1]!) as { text: string }).text)
      .join('');
    expect(text).toContain('Demo coach: scripted reply');
    const end = /event: end\ndata: (.*)\n/.exec(res.body);
    expect(end).not.toBeNull();
    const payload = JSON.parse(end![1]!) as { turnId: string | null };
    expect(payload.turnId).not.toBeNull();
  });
});
