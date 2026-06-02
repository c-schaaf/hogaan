import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { voyageEmbed } from '../../../src/shared/llm/voyage.js';
import {
  LlmAuthError,
  LlmRateLimitError,
  LlmServiceUnavailableError,
  LlmTransientError,
} from '../../../src/shared/llm/errors.js';
import { ConfigError, type AppConfig } from '../../../src/shared/secrets/config.js';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    logLevel: 'info',
    publicBaseUrl: undefined,
    databaseUrl: undefined,
    redisUrl: undefined,
    upstashRedisRestUrl: undefined,
    upstashRedisRestToken: undefined,
    encryptionKeyBase64: undefined,
    jwtSecretBase64: undefined,
    jwtIssuer: undefined,
    jwtAudience: undefined,
    anthropicApiKey: undefined,
    groqApiKey: undefined,
    voyageApiKey: 'test-voyage-key',
    sentryDsn: undefined,
    axiomToken: undefined,
    axiomDataset: undefined,
    betterstackHeartbeatUrl: undefined,
    resendApiKey: undefined,
    resendFromEmail: undefined,
    supabaseUrl: undefined,
    supabaseAnonKey: undefined,
    supabaseJwtSecret: undefined,
    ...overrides,
  };
}

function mockFetchResponse(opts: {
  status: number;
  ok?: boolean;
  jsonBody?: unknown;
  textBody?: string;
}): Response {
  const ok = opts.ok ?? (opts.status >= 200 && opts.status < 300);
  return {
    ok,
    status: opts.status,
    json: () => Promise.resolve(opts.jsonBody),
    text: () => Promise.resolve(opts.textBody ?? ''),
  } as unknown as Response;
}

const baseReq = {
  model: 'voyage-3' as const,
  texts: ['alpha', 'beta', 'gamma'],
  inputType: 'document' as const,
  timeoutMs: 5_000,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('voyageEmbed', () => {
  it('200 happy path returns embeddings array in input order', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        status: 200,
        jsonBody: {
          data: [
            { embedding: [0.1, 0.2], index: 0 },
            { embedding: [0.3, 0.4], index: 1 },
            { embedding: [0.5, 0.6], index: 2 },
          ],
          usage: { total_tokens: 12 },
        },
      }),
    );

    const result = await voyageEmbed(makeConfig(), baseReq);

    expect(result.embeddings).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
      [0.5, 0.6],
    ]);
    expect(result.totalTokens).toBe(12);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.voyageai.com/v1/embeddings');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-voyage-key');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      model: 'voyage-3',
      input: ['alpha', 'beta', 'gamma'],
      input_type: 'document',
      truncation: true,
    });
  });

  it('200 response with out-of-order index field is sorted back to input order (silent-corruption guard)', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      mockFetchResponse({
        status: 200,
        jsonBody: {
          data: [
            { embedding: [0.5, 0.6], index: 2 },
            { embedding: [0.1, 0.2], index: 0 },
            { embedding: [0.3, 0.4], index: 1 },
          ],
          usage: { total_tokens: 9 },
        },
      }),
    );

    const result = await voyageEmbed(makeConfig(), baseReq);

    expect(result.embeddings).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
      [0.5, 0.6],
    ]);
    expect(result.totalTokens).toBe(9);
  });

  it('200 with empty data array throws LlmTransientError', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse({
        status: 200,
        jsonBody: { data: [], usage: { total_tokens: 0 } },
      }),
    );

    await expect(voyageEmbed(makeConfig(), baseReq)).rejects.toBeInstanceOf(LlmTransientError);
  });

  it('401 throws LlmAuthError', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse({ status: 401, textBody: 'invalid api key' }),
    );

    await expect(voyageEmbed(makeConfig(), baseReq)).rejects.toBeInstanceOf(LlmAuthError);
  });

  it('429 throws LlmRateLimitError', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse({ status: 429, textBody: 'rate limited' }),
    );

    await expect(voyageEmbed(makeConfig(), baseReq)).rejects.toBeInstanceOf(LlmRateLimitError);
  });

  it('503 throws LlmServiceUnavailableError', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse({ status: 503, textBody: 'service unavailable' }),
    );

    await expect(voyageEmbed(makeConfig(), baseReq)).rejects.toBeInstanceOf(
      LlmServiceUnavailableError,
    );
  });

  it('418 (other 4xx) throws LlmTransientError', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse({ status: 418, textBody: "I'm a teapot" }),
    );

    await expect(voyageEmbed(makeConfig(), baseReq)).rejects.toBeInstanceOf(LlmTransientError);
  });

  it('missing voyageApiKey in config throws ConfigError', async () => {
    const cfg = makeConfig({ voyageApiKey: undefined });

    await expect(voyageEmbed(cfg, baseReq)).rejects.toBeInstanceOf(ConfigError);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
