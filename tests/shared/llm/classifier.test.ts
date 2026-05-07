import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifierChat, _internal } from '../../../src/shared/llm/classifier.js';
import { LlmServiceUnavailableError } from '../../../src/shared/llm/errors.js';
import type { AppConfig } from '../../../src/shared/secrets/config.js';

/**
 * Batch G — classifierChat wrapper for Anthropic Haiku 4.5 small/fast tasks.
 *
 * Uses the prefill-`{` pattern to force JSON output (Anthropic has no
 * native jsonMode). The wrapper reconstructs full JSON by prepending `{`.
 */

vi.mock('../../../src/shared/llm/anthropic.js', () => ({
  anthropicChat: vi.fn(),
}));

const cfg = {} as unknown as AppConfig;

beforeEach(async () => {
  const mod = await import('../../../src/shared/llm/anthropic.js');
  vi.mocked(mod.anthropicChat).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Batch G — classifierChat', () => {
  it('calls anthropicChat with claude-haiku-4-5, temperature 0, prefill `{`', async () => {
    const mod = await import('../../../src/shared/llm/anthropic.js');
    vi.mocked(mod.anthropicChat).mockResolvedValue({
      text: '"verdict":"grounded"}',
      inputTokens: 100,
      outputTokens: 30,
      stopReason: 'end_turn',
    });

    await classifierChat(cfg, {
      systemPrompt: 'system text',
      userPrompt: 'user text',
    });

    expect(mod.anthropicChat).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mod.anthropicChat).mock.calls[0]![1];
    expect(call.model).toBe('claude-haiku-4-5');
    expect(call.temperature).toBe(0);
    expect(call.systemPrompt).toBe('system text');
    expect(call.messages).toEqual([
      { role: 'user', content: 'user text' },
      { role: 'assistant', content: '{' },
    ]);
    expect(call.maxTokens).toBe(_internal.DEFAULT_MAX_TOKENS);
    expect(call.timeoutMs).toBe(_internal.DEFAULT_TIMEOUT_MS);
  });

  it('reconstructs full JSON by prepending `{` to the continuation', async () => {
    const mod = await import('../../../src/shared/llm/anthropic.js');
    vi.mocked(mod.anthropicChat).mockResolvedValue({
      text: '"verdict":"grounded","evidence_quote":"q"}',
      inputTokens: 100,
      outputTokens: 30,
      stopReason: 'end_turn',
    });

    const r = await classifierChat(cfg, { systemPrompt: 's', userPrompt: 'u' });

    expect(r.text).toBe('{"verdict":"grounded","evidence_quote":"q"}');
    expect(JSON.parse(r.text)).toEqual({ verdict: 'grounded', evidence_quote: 'q' });
    expect(r.inputTokens).toBe(100);
    expect(r.outputTokens).toBe(30);
  });

  it('defensive: if response already starts with `{`, returns as-is (no double-prepend)', async () => {
    const mod = await import('../../../src/shared/llm/anthropic.js');
    // Some hypothetical case where Haiku ignored prefill and returned full JSON.
    vi.mocked(mod.anthropicChat).mockResolvedValue({
      text: '{"verdict":"grounded"}',
      inputTokens: 100,
      outputTokens: 30,
      stopReason: 'end_turn',
    });

    const r = await classifierChat(cfg, { systemPrompt: 's', userPrompt: 'u' });

    expect(r.text).toBe('{"verdict":"grounded"}');
    // Should NOT be {{"verdict"... — the defensive guard prevents that.
    expect(r.text).not.toMatch(/^\{\{/);
  });

  it('respects caller-provided maxTokens, timeoutMs, temperatureOverride', async () => {
    const mod = await import('../../../src/shared/llm/anthropic.js');
    vi.mocked(mod.anthropicChat).mockResolvedValue({
      text: '}',
      inputTokens: 50,
      outputTokens: 5,
      stopReason: 'end_turn',
    });

    await classifierChat(cfg, {
      systemPrompt: 's',
      userPrompt: 'u',
      maxTokens: 50,
      timeoutMs: 1500,
      temperatureOverride: 0.2,
    });

    const call = vi.mocked(mod.anthropicChat).mock.calls[0]![1];
    expect(call.maxTokens).toBe(50);
    expect(call.timeoutMs).toBe(1500);
    expect(call.temperature).toBe(0.2);
  });

  it('LlmError propagates unchanged from anthropicChat', async () => {
    const mod = await import('../../../src/shared/llm/anthropic.js');
    vi.mocked(mod.anthropicChat).mockRejectedValue(
      new LlmServiceUnavailableError('anthropic', 'haiku 503'),
    );

    await expect(
      classifierChat(cfg, { systemPrompt: 's', userPrompt: 'u' }),
    ).rejects.toBeInstanceOf(LlmServiceUnavailableError);
  });
});
