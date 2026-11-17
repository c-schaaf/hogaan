// A hosted demo puts demo mode (everyone is the sample leader) on a public
// address. These tests pin the two protections that make that acceptable:
// it will not start without an access code, and nothing but the health
// checks and the MCP endpoint is reachable without it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoAccessCode, startDemoServer, type DemoServer } from '../../src/demo/server.js';
import { chat } from '../../src/shared/llm/chat.js';
import { DEMO_BUDGET_MARKER, resetDemoBudgetForTests } from '../../src/shared/llm/demo-budget.js';
import { DEMO_ACCESS_TOKEN } from '../../src/web-api/supabase-session.js';

const CODE = 'correct-horse-battery';
const saved = { ...process.env };

describe('hosted demo: start rules', () => {
  it('refuses to start hosted without an access code', () => {
    expect(() => demoAccessCode({ DEMO_HOSTED: 'true' })).toThrow(/DEMO_ACCESS_CODE/);
    expect(() => demoAccessCode({ RENDER: 'true' })).toThrow(/DEMO_ACCESS_CODE/);
    expect(() => demoAccessCode({ RAILWAY_PROJECT_ID: 'abc' })).toThrow(/DEMO_ACCESS_CODE/);
  });
  it('refuses a short access code', () => {
    expect(() => demoAccessCode({ DEMO_ACCESS_CODE: 'short' })).toThrow(/at least 8/);
  });
  it('a local demo may run without one', () => {
    expect(demoAccessCode({})).toBeUndefined();
  });
});

describe('hosted demo: access gate', () => {
  let demo: DemoServer;
  const bearer = { authorization: `Bearer ${DEMO_ACCESS_TOKEN}` };

  beforeAll(async () => {
    process.env = {
      NODE_ENV: 'test',
      PORT: '3998',
      LOG_LEVEL: 'error',
      DEMO_HOSTED: 'true',
      DEMO_ACCESS_CODE: CODE,
    };
    demo = await startDemoServer({ listen: false, webDistDir: '/nonexistent' });
  }, 60_000);
  afterAll(async () => {
    await demo?.close();
    process.env = { ...saved };
  });

  async function cookieFor(code: string): Promise<string | undefined> {
    const res = await demo.app.inject({ url: `/?access=${encodeURIComponent(code)}` });
    const raw = res.headers['set-cookie'];
    const first = Array.isArray(raw) ? raw[0] : raw;
    return first?.split(';')[0];
  }

  it('blocks the app and the API without the code, even with the demo sign-in token', async () => {
    const page = await demo.app.inject({ url: '/' });
    expect(page.statusCode).toBe(401);
    expect(page.body).toContain('Access code');
    const api = await demo.app.inject({ url: '/api/profile', headers: bearer });
    expect(api.statusCode).toBe(401);
    expect(api.body).not.toContain('Amina');
    const features = await demo.app.inject({ url: '/api/features' });
    expect(features.statusCode).toBe(401);
  });

  it('rejects a wrong code and sets no cookie', async () => {
    const res = await demo.app.inject({ url: '/?access=wrong-code-entirely' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('the access link sets a cookie, drops the code from the address, and lets the visitor in', async () => {
    const res = await demo.app.inject({ url: `/moments?access=${CODE}&x=1` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/moments?x=1');
    const cookie = await cookieFor(CODE);
    expect(cookie).toMatch(/^hg_demo_access=[0-9a-f]{64}$/);
    expect(cookie).not.toContain(CODE);
    const api = await demo.app.inject({
      url: '/api/profile',
      headers: { ...bearer, cookie: cookie! },
    });
    expect(api.statusCode).toBe(200);
    expect(api.json()).toMatchObject({ fullName: 'Amina Farah' });
  });

  it('a made-up cookie does not work', async () => {
    const api = await demo.app.inject({
      url: '/api/profile',
      headers: { ...bearer, cookie: `hg_demo_access=${'0'.repeat(64)}` },
    });
    expect(api.statusCode).toBe(401);
  });

  it('health checks stay open, and the MCP endpoint keeps its own key check', async () => {
    expect((await demo.app.inject({ url: '/healthz' })).statusCode).toBe(200);
    const mcp = await demo.app.inject({ method: 'POST', url: '/mcp', payload: {} });
    expect(mcp.body).not.toContain('Access code');
  });
});

describe('hosted demo: AI budget', () => {
  it('answers with a clearly labelled scripted reply once the day is spent, without calling the model', async () => {
    resetDemoBudgetForTests();
    const config = {
      demoMode: true,
      demoDailyModelCalls: 0,
      anthropicApiKey: 'sk-ant-not-a-real-key',
    } as Parameters<typeof chat>[0];
    const res = await chat(
      config,
      {
        systemPrompt: 'You are a leadership coach.',
        messages: [{ role: 'user', content: 'I have a hard conversation Friday.' }],
        maxTokens: 200,
      },
      'safe',
    );
    expect(res.modelUsed).toBe('scripted-demo');
    expect(res.text).toContain(DEMO_BUDGET_MARKER);
    expect(res.inputTokens).toBe(0);
  });
});
