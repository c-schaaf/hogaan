import { afterEach, describe, expect, it } from 'vitest';
import { chat, chatStream, resetChatBreakersForTests } from '../../../src/shared/llm/chat.js';
import { resetAnthropicClientForTests } from '../../../src/shared/llm/anthropic.js';
import { fakeConfig } from '../../phase-10/helpers/fakes.js';
import { installModelStub } from '../../helpers/model-stub.js';

afterEach(() => {
  resetAnthropicClientForTests();
  resetChatBreakersForTests();
});

const req = {
  systemPrompt: 'sys',
  messages: [{ role: 'user' as const, content: 'hi' }],
  maxTokens: 600,
  temperature: 0.7,
};

describe('P1.5 model migration parameters (per the official migration guide)', () => {
  it('default stays claude-haiku-4-5 with temperature and no effort (no behaviour change on merge)', async () => {
    const stub = installModelStub();
    const s = chatStream(fakeConfig(), req);
    for await (const _ of s) void _;
    const p = stub.calls[0]!;
    expect(p['model']).toBe('claude-haiku-4-5');
    expect(p['temperature']).toBe(0.7);
    expect(p['output_config']).toBeUndefined();
    expect(p['max_tokens']).toBe(600);
  });

  it('claude-haiku-5-5: no temperature, explicit effort, room for thinking in max_tokens', async () => {
    const stub = installModelStub();
    const s = chatStream(
      fakeConfig({ llmChatModel: 'claude-haiku-5-5', llmChatEffort: 'low' }),
      req,
    );
    for await (const _ of s) void _;
    const p = stub.calls[0]!;
    expect(p['model']).toBe('claude-haiku-5-5');
    expect(p['temperature']).toBeUndefined();
    expect(p['output_config']).toEqual({ effort: 'low' });
    expect(p['max_tokens'] as number).toBeGreaterThanOrEqual(2048);
  });

  it('non-streaming chat() honours the configured model and reports it', async () => {
    installModelStub();
    const r = await chat(fakeConfig({ llmChatModel: 'claude-haiku-5-5' }), req, 'safe');
    expect(r.modelUsed).toBe('claude-haiku-5-5');
  });

  it('demo mode without a key never calls the provider (scripted coach)', async () => {
    const stub = installModelStub();
    const r = await chat(fakeConfig({ demoMode: true, anthropicApiKey: undefined }), req, 'safe');
    expect(r.modelUsed).toBe('scripted-demo');
    expect(stub.calls.length).toBe(0);
  });
});
