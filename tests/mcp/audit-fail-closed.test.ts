import { describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../../src/mcp/server.js';
import { demoTestConfig } from '../helpers/embedded.js';

describe('P3.4 every MCP tool call is audited, fail-closed', () => {
  it('when the audit write fails the tool refuses and does no work', async () => {
    const db = { select: vi.fn(), insert: vi.fn() };
    const server = buildMcpServer({
      config: demoTestConfig(),
      db: db as never,
      userId: '00000000-0000-4000-8000-000000000001',
      audit: () => Promise.reject(new Error('audit db down')),
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: 't', version: '1' });
    await client.connect(b);
    const r = (await client.callTool({
      name: 'save_note',
      arguments: { text: 'x', kind: 'note' },
    })) as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toMatch(/could not record this request/);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
