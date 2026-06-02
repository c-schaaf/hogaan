import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../src/shared/secrets/config.js';

const reportP1Spy = vi.fn();
vi.mock('../../../src/incident-handling/index.js', () => ({
  reportP1: (...args: unknown[]): void => {
    reportP1Spy(...args);
  },
}));

import { sendEmail } from '../../../src/shared/email/resend.js';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 0,
    logLevel: 'error',
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
    voyageApiKey: undefined,
    sentryDsn: undefined,
    axiomToken: undefined,
    axiomDataset: undefined,
    betterstackHeartbeatUrl: undefined,
    resendApiKey: 'rsd-test-key',
    resendFromEmail: 'coach@hogaanai.com',
    supabaseUrl: undefined,
    supabaseAnonKey: undefined,
    supabaseJwtSecret: undefined,
    ...overrides,
  };
}

const baseOpts = {
  to: 'leader@example.com',
  subject: 'Welcome to Hogaan',
  html: '<p>hi</p>',
  text: 'hi',
  source: 'signup-verification',
};

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

beforeEach(() => {
  reportP1Spy.mockReset();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sendEmail (Resend transport)', () => {
  it('200 happy path returns ok:true with provider messageId', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse({ status: 200, jsonBody: { id: 'msg_01HQ' } }),
    );

    const result = await sendEmail(makeConfig(), baseOpts);

    expect(result).toEqual({ ok: true, messageId: 'msg_01HQ' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer rsd-test-key');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      from: 'coach@hogaanai.com',
      to: ['leader@example.com'],
      subject: 'Welcome to Hogaan',
      html: '<p>hi</p>',
      text: 'hi',
    });
  });

  it.todo(
    '422 rejection: reportP1 extra.detail must NOT contain recipient email — Batch B prod bug: src/shared/email/resend.ts L74-84 forwards raw 200-char body slice to extra.detail, leaking recipient PII when Resend echoes the address in its error body',
  );

  it('422 rejection: still returns ok:false with sanitized reason and fires reportP1', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockFetchResponse({
        status: 422,
        textBody: 'validation_error: invalid recipient',
      }),
    );

    const result = await sendEmail(makeConfig(), baseOpts);

    expect(result).toEqual({ ok: false, reason: 'resend_422' });
    expect(reportP1Spy).toHaveBeenCalledTimes(1);
    const ctx = reportP1Spy.mock.calls[0]![1] as {
      source: string;
      tags?: Record<string, string>;
      extra?: Record<string, unknown>;
    };
    expect(ctx.source).toBe('signup-verification');
    expect(ctx.tags).toEqual({ status: '422' });
  });

  it('network error: fetch throws → returns ok:false with resend_network_error and fires reportP1', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNRESET'));

    const result = await sendEmail(makeConfig(), baseOpts);

    expect(result).toEqual({ ok: false, reason: 'resend_network_error' });
    expect(reportP1Spy).toHaveBeenCalledTimes(1);
    const [message, ctx] = reportP1Spy.mock.calls[0]! as [
      string,
      { source: string; extra?: Record<string, unknown> },
    ];
    expect(message).toBe('Resend network error');
    expect(ctx.source).toBe('signup-verification');
    expect(ctx.extra).toEqual({ error: 'ECONNRESET' });
  });

  it.todo(
    'AbortSignal timeout returns reason="resend_timeout" — Batch B prod bug: src/shared/email/resend.ts L65-71 catches AbortError under the generic network-error branch, so timeouts are not distinguishable from connection failures',
  );

  it('AbortSignal timeout currently surfaces as resend_network_error (documents current behaviour, deterministic)', async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    vi.mocked(fetch).mockRejectedValue(abortErr);

    const result = await sendEmail(makeConfig(), baseOpts);

    expect(result).toEqual({ ok: false, reason: 'resend_network_error' });
    expect(reportP1Spy).toHaveBeenCalledTimes(1);
    expect(reportP1Spy.mock.calls[0]![0]).toBe('Resend network error');
  });

  it('missing resendApiKey returns resend_not_configured WITHOUT calling fetch', async () => {
    const result = await sendEmail(makeConfig({ resendApiKey: undefined }), baseOpts);

    expect(result).toEqual({ ok: false, reason: 'resend_not_configured' });
    expect(fetch).not.toHaveBeenCalled();
    expect(reportP1Spy).toHaveBeenCalledTimes(1);
    expect(reportP1Spy.mock.calls[0]![0]).toBe('Resend not configured; email cannot send');
  });

  it('missing resendFromEmail returns resend_not_configured WITHOUT calling fetch', async () => {
    const result = await sendEmail(makeConfig({ resendFromEmail: undefined }), baseOpts);

    expect(result).toEqual({ ok: false, reason: 'resend_not_configured' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
