import type Anthropic from '@anthropic-ai/sdk';
import { __setAnthropicClientForTests } from '../../src/shared/llm/anthropic.js';

/**
 * Captures every request the app sends to the Anthropic client and answers
 * with canned text (streaming) or canned JSON (background calls).
 */
export interface ModelStub {
  calls: Record<string, unknown>[];
  setJson(value: unknown): void;
  setReply(text: string): void;
}

export function installModelStub(): ModelStub {
  const calls: Record<string, unknown>[] = [];
  let json: unknown = {};
  let reply = 'What matters most to you about this?';
  const client = {
    messages: {
      create: (params: Record<string, unknown>) => {
        calls.push(params);
        if (params['stream'] === true) {
          const events = [
            { type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 0 } } },
            { type: 'content_block_delta', delta: { type: 'text_delta', text: reply } },
            {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn' },
              usage: { output_tokens: 5 },
            },
          ];
          return Promise.resolve({
            // eslint-disable-next-line @typescript-eslint/require-await -- canned events
            async *[Symbol.asyncIterator]() {
              for (const e of events) yield e;
            },
          });
        }
        return Promise.resolve({
          content: [{ type: 'text', text: JSON.stringify(json) }],
          usage: { input_tokens: 10, output_tokens: 5 },
          stop_reason: 'end_turn',
        });
      },
    },
  };
  __setAnthropicClientForTests(client as unknown as Anthropic);
  return {
    calls,
    setJson: (v) => {
      json = v;
    },
    setReply: (t) => {
      reply = t;
    },
  };
}
