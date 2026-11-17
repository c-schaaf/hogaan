// A hosted demo can register one fixed assistant (MCP) key for the sample
// leader, and, in demo mode only, accept it in the address.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDemoServer, type DemoServer } from '../../src/demo/server.js';
import { isValidFixedToken } from '../../src/mcp/tokens.js';

const KEY = 'hgn_demo-0123456789abcdefghij';
const saved = { ...process.env };
const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0' },
  },
};
const headers = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

describe('demo: fixed assistant key', () => {
  let demo: DemoServer;
  let base: string;

  beforeAll(async () => {
    process.env = { NODE_ENV: 'test', PORT: '3997', LOG_LEVEL: 'error', DEMO_MCP_KEY: KEY };
    demo = await startDemoServer({ webDistDir: '/nonexistent' });
    base = 'http://127.0.0.1:3997';
  }, 60_000);
  afterAll(async () => {
    await demo?.close();
    process.env = { ...saved };
  });

  it('accepts the key as a bearer header, exactly like a key made on Profile', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { ...headers, authorization: `Bearer ${KEY}` },
      body: JSON.stringify(INIT),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('serverInfo');
  });

  it('accepts the key in the address (demo mode only)', async () => {
    const res = await fetch(`${base}/mcp/key/${KEY}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(INIT),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('serverInfo');
  });

  it('rejects a wrong key in the address', async () => {
    const res = await fetch(`${base}/mcp/key/hgn_not-the-right-key-000000`, {
      method: 'POST',
      headers,
      body: JSON.stringify(INIT),
    });
    expect(res.status).toBe(401);
  });

  it('only accepts well-formed fixed keys', () => {
    expect(isValidFixedToken(KEY)).toBe(true);
    expect(isValidFixedToken('hgn_short')).toBe(false);
    expect(isValidFixedToken('no-prefix-but-long-enough-000000')).toBe(false);
  });
});
