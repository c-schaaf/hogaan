/**
 * P3 "Done when": from an assistant with a calendar connection, "prep me for
 * my 2pm" returns coaching in Hogaan's voice that uses the leader's stored
 * context, and the moment appears in the Hogaan app.
 *
 * The "assistant" here is the official MCP TypeScript client talking to the
 * real /mcp endpoint over HTTP. Its calendar is simulated by passing the
 * meeting text it would have fetched. The model behind `coach` is stubbed
 * and every request to it is inspected.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { promptTemplatesV2Unified, publishLibraryVersion } from '../../src/libraries/index.js';
import { resetResolverForTests } from '../../src/libraries/resolver.js';
import { saveBrief } from '../../src/leader-context/store.js';
import { emptyBrief } from '../../src/leader-context/types.js';
import type { EmbeddedDb } from '../../src/shared/db/embedded.js';
import { resetEncryptionCache } from '../../src/shared/db/encryption.js';
import { auditLog } from '../../src/shared/db/schema/audit-log.js';
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

// Billing (Phase 4) is tested separately; here every leader is entitled.
const config = demoTestConfig({
  demoMode: false,
  anthropicApiKey: 'sk-test-stub',
  features: { ...demoTestConfig().features, billing: false },
});
let edb: EmbeddedDb;
let app: FastifyInstance;
let base = '';
let stub: ModelStub;
let token = '';

async function connect(bearer: string): Promise<Client> {
  const client = new Client({ name: 'test-assistant', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  await client.connect(transport);
  return client;
}
const textOf = (r: unknown) =>
  (r as { content: { type: string; text: string }[] }).content[0]?.text ?? '';

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
  const brief = emptyBrief();
  brief.profileFields = { title: 'Program director', teamShape: 'six direct reports' };
  await saveBrief(config, edb.db, current, brief, { updatedBy: 'test' });
  stub = installModelStub();
  stub.setReply('Before the review, what does your director most need to hear from you?');
  app = await buildRealApp(config, edb.db);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr !== null ? addr.port : 0}`;
}, 60_000);

afterAll(async () => {
  resetAnthropicClientForTests();
  await app.close();
  await edb.close();
});

describe('P3 Hogaan MCP server', () => {
  it('the leader creates an assistant token in the app (shown once)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp/tokens',
      payload: { label: 'My assistant' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ token: string; serverUrl: string }>();
    expect(body.token).toMatch(/^hgn_/);
    expect(body.serverUrl).toMatch(/\/mcp$/);
    token = body.token;
  });

  it('lists the six tools and three prompts', async () => {
    const client = await connect(token);
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(
      [
        'coach',
        'get_leader_context',
        'get_practice_guidance',
        'log_moment',
        'log_outcome',
        'save_note',
      ].sort(),
    );
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name).sort();
    expect(prompts).toEqual(['manage_up', 'prep_next_meeting', 'review_draft_tone']);
    await client.close();
  });

  it('done-when: "prep me for my 2pm" -> Hogaan coaching with stored context; moment shows in the app', async () => {
    const client = await connect(token);
    // What the assistant fetched from the leader's calendar:
    const meeting = 'Budget review with my director Sarah Johnson at 2pm today, sarah@org.example';

    const ctx = textOf(await client.callTool({ name: 'get_leader_context', arguments: {} }));
    expect(ctx).toContain('Program director');

    const logged = textOf(
      await client.callTool({
        name: 'log_moment',
        arguments: {
          what: 'Budget review',
          with_whom: 'my director',
          when: '2026-11-12T20:00:00Z',
        },
      }),
    );
    expect(logged).toMatch(/Saved\. Moment id/);

    const coaching = textOf(
      await client.callTool({
        name: 'coach',
        arguments: { situation: `Prep me for my 2pm: ${meeting}` },
      }),
    );
    expect(coaching).toBe('Before the review, what does your director most need to hear from you?');

    // Hogaan's engine used Hogaan's prompt + the stored brief, and D2 held.
    const call = stub.calls.at(-1)!;
    const wire = JSON.stringify({ system: call['system'], messages: call['messages'] });
    expect(wire).toContain('Hogaan');
    expect(wire).toContain('Program director');
    expect(wire).toContain('Budget review');
    expect(wire).not.toContain('Johnson');
    expect(wire).not.toContain('sarah@org.example');

    // The moment is in the app.
    const list = (await app.inject({ url: '/api/moments' })).json<{ moments: MomentView[] }>()
      .moments;
    expect(list.find((m) => m.what === 'Budget review')).toMatchObject({
      source: 'assistant',
      withWhom: 'my director',
    });
    // And the coaching exchange appears in Sessions.
    const sessions = (await app.inject({ url: '/api/sessions' })).json<{
      sessions: { title: string }[];
    }>().sessions;
    expect(sessions.some((s) => s.title.startsWith('Via your AI assistant'))).toBe(true);
    await client.close();
  });

  it('writes go through the PII filter and every tool call is audited', async () => {
    const client = await connect(token);
    await client.callTool({
      name: 'save_note',
      arguments: { text: 'Works closely with Omar Abdi (omar@x.org)', kind: 'note' },
    });
    await client.callTool({
      name: 'log_outcome',
      arguments: {
        what: 'Budget review',
        how_it_went: 'well',
        differently: 'Call Omar Abdi earlier',
      },
    });
    const brief = (await app.inject({ url: '/api/brief' })).json<{
      notes: { text: string; source: string }[];
    }>();
    const all = JSON.stringify(brief.notes);
    expect(all).toContain('Works closely with Omar');
    expect(all).not.toContain('Abdi');
    expect(all).not.toContain('omar@x.org');
    expect(brief.notes.some((n) => n.source === 'assistant')).toBe(true);
    const audits = await edb.db.select().from(auditLog).where(eq(auditLog.triggerSource, 'mcp'));
    const events = audits.map((a) => a.targetEndEvent);
    for (const e of [
      'MCP_get_leader_context',
      'MCP_log_moment',
      'MCP_coach',
      'MCP_save_note',
      'MCP_log_outcome',
    ]) {
      expect(events).toContain(e);
    }
    await client.close();
  });

  it('practice guidance stays short (D6) and falls back without an approved digest', async () => {
    const client = await connect(token);
    const g = textOf(
      await client.callTool({
        name: 'get_practice_guidance',
        arguments: { situation: 'team conflict' },
      }),
    );
    expect(g).toContain('Peace (Community)');
    expect(g.length).toBeLessThan(1200);
    await client.close();
  });

  it('rejects missing, wrong and revoked tokens; 404 when the flag is off', async () => {
    const noAuth = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(noAuth.status).toBe(401);
    await expect(connect('hgn_wrong')).rejects.toThrow();

    const list = (await app.inject({ url: '/api/mcp/tokens' })).json<{
      tokens: { id: string }[];
    }>();
    await app.inject({ method: 'DELETE', url: `/api/mcp/tokens/${list.tokens[0]!.id}` });
    await expect(connect(token)).rejects.toThrow();

    const offApp = await buildRealApp(demoTestConfig({ features: {} }), edb.db);
    expect((await offApp.inject({ method: 'POST', url: '/mcp', payload: {} })).statusCode).toBe(
      404,
    );
  });
});
