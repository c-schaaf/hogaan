import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';
import { initSentry, setSentryUser } from '../../../src/shared/observability/incidents.js';
import type { AppConfig } from '../../../src/shared/secrets/config.js';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  setUser: vi.fn(),
  withScope: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  close: vi.fn(() => Promise.resolve()),
}));

function fakeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
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
    ...overrides,
  };
}

describe('setSentryUser', () => {
  beforeEach(() => {
    // initSentry is idempotent — first call wins for the module-scoped
    // `initialized` flag, so calling it here once across all tests is fine.
    initSentry(fakeConfig());
    vi.mocked(Sentry.setUser).mockClear();
  });

  afterEach(() => {
    vi.mocked(Sentry.setUser).mockClear();
  });

  it('calls Sentry.setUser with { id } using the internal user id', () => {
    setSentryUser('user-uuid-abc');
    expect(Sentry.setUser).toHaveBeenCalledTimes(1);
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'user-uuid-abc' });
  });

  it('passes only the id field — never email or other PII', () => {
    setSentryUser('user-uuid-xyz');
    const arg = vi.mocked(Sentry.setUser).mock.calls[0]?.[0];
    expect(arg).toBeDefined();
    expect(Object.keys(arg as object)).toEqual(['id']);
  });

  it('is safe to call repeatedly — last call wins', () => {
    setSentryUser('user-1');
    setSentryUser('user-2');
    setSentryUser('user-3');
    expect(Sentry.setUser).toHaveBeenCalledTimes(3);
    expect(Sentry.setUser).toHaveBeenLastCalledWith({ id: 'user-3' });
  });

  it('does not throw on edge-case ids (empty string, very long)', () => {
    expect(() => setSentryUser('')).not.toThrow();
    expect(() => setSentryUser('a'.repeat(1000))).not.toThrow();
  });
});
