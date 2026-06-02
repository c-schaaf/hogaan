import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import {
  initSentry,
  reportIncident,
  shutdownSentry,
} from '../../../src/shared/observability/incidents.js';
import type { AppConfig } from '../../../src/shared/secrets/config.js';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  setUser: vi.fn(),
  withScope: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  close: vi.fn(() => Promise.resolve()),
}));

describe('incidents — phone redaction (PHONE_RE truth table)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Ensure Sentry is uninitialized so reportIncident falls back to console.warn.
    await shutdownSentry();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function callAndExtractMessage(input: string): string {
    reportIncident('P2', input, { source: 'test' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const raw = warnSpy.mock.calls[0]?.[0];
    expect(typeof raw).toBe('string');
    const payload = JSON.parse(raw as string) as { message: string };
    return payload.message;
  }

  it('redacts a +country-code phone number ("+254722178177") to <phone-redacted>', () => {
    const out = callAndExtractMessage('user reported +254722178177 in form');
    expect(out).toBe('user reported <phone-redacted> in form');
  });

  it('redacts an international 00-prefixed number ("00252612345678") to <phone-redacted>', () => {
    const out = callAndExtractMessage('callback to 00252612345678 failed');
    expect(out).toBe('callback to <phone-redacted> failed');
  });

  it('passes through strings with no phone-like digit runs untouched', () => {
    const out = callAndExtractMessage('no phone here');
    expect(out).toBe('no phone here');
  });

  it('PHONE_RE false-positive lock-in: a 16-char hex emailHash-like value with no 10-digit run is left intact', () => {
    // F5 correlation key concern: PHONE_RE only matches >=10 contiguous digits.
    // The value below ("a1b2c3d4e5f67890") has at most 5 contiguous digits
    // ("67890"), so it survives untouched. Locking in current behavior.
    const out = callAndExtractMessage('emailHash=a1b2c3d4e5f67890 fired');
    expect(out).toBe('emailHash=a1b2c3d4e5f67890 fired');
  });

  it('B4 fix: an emailHash containing a 10+ digit run adjacent to hex chars is left intact', () => {
    // Post-B4: PHONE_RE uses non-hex/alphanumeric word boundaries so an
    // emailHash whose contiguous digit run abuts hex letters no longer
    // false-positives. F5 incident→user correlation key survives.
    const out = callAndExtractMessage('emailHash=1234567890abcdef fired');
    expect(out).toBe('emailHash=1234567890abcdef fired');
  });

  it('B4 regression: a phone number adjacent to a hex string still redacts when separated by whitespace', () => {
    const out = callAndExtractMessage('hash=abcdef0123 +254722178177 next');
    expect(out).toBe('hash=abcdef0123 <phone-redacted> next');
  });
});

describe('reportIncident — Sentry-uninitialized fallback to console.warn', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await shutdownSentry();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('logs a structured JSON payload with kind, severity, message, ctx when no err is passed', () => {
    reportIncident('P1', 'thing broke', {
      source: 'Process_12.Step_8_AuditLog',
      tags: { route: '/api/chat' },
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const raw = warnSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(raw) as Record<string, unknown>;
    expect(payload).toEqual({
      kind: 'incident',
      severity: 'P1',
      message: 'thing broke',
      ctx: {
        source: 'Process_12.Step_8_AuditLog',
        tags: { route: '/api/chat' },
      },
    });
  });

  it('includes a formatted err field when a non-empty Error is passed', () => {
    const err = new Error('boom +254722178177');
    err.name = 'BoomError';
    reportIncident('P0', 'fatal', { source: 'Process_11' }, err);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const raw = warnSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(raw) as {
      severity: string;
      err: { name: string; message: string };
    };
    expect(payload.severity).toBe('P0');
    expect(payload.err).toEqual({ name: 'BoomError', message: 'boom <phone-redacted>' });
  });
});

describe('reportIncident — formatErrForDev shape coverage', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await shutdownSentry();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function callAndExtractErr(err: unknown): unknown {
    reportIncident('P2', 'msg', { source: 'test' }, err);
    const raw = warnSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(raw) as { err?: unknown };
    return payload.err;
  }

  it('formats an Error into { name, message } and redacts phone-like runs in message', () => {
    const out = callAndExtractErr(new Error('failed for 00252612345678'));
    expect(out).toEqual({ name: 'Error', message: 'failed for <phone-redacted>' });
  });

  it('formats a string into { value } and redacts phones', () => {
    const out = callAndExtractErr('raw +254722178177');
    expect(out).toEqual({ value: 'raw <phone-redacted>' });
  });

  it('formats a number via the dedicated primitive branch (NOT the JSON.stringify fallback)', () => {
    const jsonSpy = vi.spyOn(JSON, 'stringify');
    const out = callAndExtractErr(42);
    expect(out).toEqual({ value: '42' });
    // Only the outer reportIncident payload wrapper should call JSON.stringify.
    // If the dedicated number branch in formatErrForDev is deleted, the fallback
    // at the bottom of the function invokes JSON.stringify(42) and this trips.
    expect(jsonSpy).toHaveBeenCalledTimes(1);
    jsonSpy.mockRestore();
  });

  it('formats a boolean via the dedicated primitive branch (NOT the JSON.stringify fallback)', () => {
    const jsonSpy = vi.spyOn(JSON, 'stringify');
    const out = callAndExtractErr(true);
    expect(out).toEqual({ value: 'true' });
    expect(jsonSpy).toHaveBeenCalledTimes(1);
    jsonSpy.mockRestore();
  });

  it('formats null via the dedicated null branch (NOT the JSON.stringify fallback)', () => {
    const jsonSpy = vi.spyOn(JSON, 'stringify');
    const out = callAndExtractErr(null);
    expect(out).toEqual({ value: 'null' });
    expect(jsonSpy).toHaveBeenCalledTimes(1);
    jsonSpy.mockRestore();
  });

  it('omits the err field entirely when undefined is passed', () => {
    reportIncident('P2', 'msg', { source: 'test' }, undefined);
    const raw = warnSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(raw) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('err');
  });

  it('formats a plain object via JSON.stringify and redacts phone-like runs', () => {
    const out = callAndExtractErr({ phone: '+254722178177', other: 'x' });
    expect(out).toEqual({ value: '{"phone":"<phone-redacted>","other":"x"}' });
  });

  it('handles a circular object by emitting { value: "<unserializable>" } without throwing', () => {
    type Cyclic = { self?: Cyclic; label: string };
    const cyclic: Cyclic = { label: 'self' };
    cyclic.self = cyclic;
    expect(() => callAndExtractErr(cyclic)).not.toThrow();
    const raw = warnSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(raw) as { err: { value: string } };
    expect(payload.err).toEqual({ value: '<unserializable>' });
  });
});

describe('B10: Sentry beforeSend scrubs PII from extra, tags, message', () => {
  type BeforeSend = (event: Sentry.Event) => Sentry.Event | null;

  function fakeConfig(): AppConfig {
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
      sentryDsn: 'https://fake@sentry.io/1',
      axiomToken: undefined,
      axiomDataset: undefined,
      betterstackHeartbeatUrl: undefined,
      resendApiKey: undefined,
      resendFromEmail: undefined,
      supabaseUrl: undefined,
      supabaseAnonKey: undefined,
      supabaseJwtSecret: undefined,
    };
  }

  async function captureBeforeSend(): Promise<BeforeSend> {
    await shutdownSentry();
    vi.mocked(Sentry.init).mockClear();
    initSentry(fakeConfig());
    const call = vi.mocked(Sentry.init).mock.calls[0];
    expect(call).toBeDefined();
    const options = call?.[0] as { beforeSend?: BeforeSend } | undefined;
    expect(options?.beforeSend).toBeTypeOf('function');
    return options!.beforeSend!;
  }

  afterEach(async () => {
    await shutdownSentry();
  });

  it('scrubs extra.email value via PII key match', async () => {
    const beforeSend = await captureBeforeSend();
    const event: Sentry.Event = { extra: { email: 'leak@example.com', other: 'safe' } };
    const out = beforeSend(event);
    expect(out).not.toBeNull();
    expect(out!.extra?.['email']).toBe('<redacted>');
    expect(out!.extra?.['other']).toBe('safe');
  });

  it('scrubs tags.user_email value via PII key match', async () => {
    const beforeSend = await captureBeforeSend();
    const event: Sentry.Event = { tags: { user_email: 'leak@example.com', route: '/api/chat' } };
    const out = beforeSend(event);
    expect(out).not.toBeNull();
    expect(out!.tags?.['user_email']).toBe('<redacted>');
    expect(out!.tags?.['route']).toBe('/api/chat');
  });

  it('scrubs email-shaped substrings from event.message', async () => {
    const beforeSend = await captureBeforeSend();
    const event: Sentry.Event = { message: 'user leak@example.com hit error' };
    const out = beforeSend(event);
    expect(out).not.toBeNull();
    expect(out!.message).toBe('user <email-redacted> hit error');
  });

  it('recursively scrubs nested PII keys inside extra (e.g. extra.user.email)', async () => {
    const beforeSend = await captureBeforeSend();
    const event: Sentry.Event = {
      extra: { user: { email: 'leak@example.com', role: 'admin' } },
    };
    const out = beforeSend(event);
    expect(out).not.toBeNull();
    const user = (out!.extra as Record<string, unknown>)['user'] as Record<string, unknown>;
    expect(user['email']).toBe('<redacted>');
    expect(user['role']).toBe('admin');
  });

  it('scrubs email-shaped strings inside arrays under non-PII keys', async () => {
    const beforeSend = await captureBeforeSend();
    const event: Sentry.Event = {
      extra: { items: ['leak@example.com', 'safe'] },
    };
    const out = beforeSend(event);
    expect(out).not.toBeNull();
    const items = (out!.extra as Record<string, unknown>)['items'] as unknown[];
    expect(items[0]).toBe('<email-redacted>');
    expect(items[1]).toBe('safe');
  });

  it('leaves benign keys whose name CONTAINS "email" untouched (e.g. email_template_id)', async () => {
    const beforeSend = await captureBeforeSend();
    const event: Sentry.Event = {
      extra: { email_template_id: 'tpl_abc123', email_count: 42 },
    };
    const out = beforeSend(event);
    expect(out).not.toBeNull();
    expect(out!.extra?.['email_template_id']).toBe('tpl_abc123');
    expect(out!.extra?.['email_count']).toBe(42);
  });
});
