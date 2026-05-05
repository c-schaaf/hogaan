import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  issueSessionToken,
  resetTokenCacheForTests,
  TokenInvalidError,
  validateSessionToken,
} from '../../src/identity/token.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';
import { asUserId } from '../../src/shared/types/index.js';

function configWith(
  secret: string | undefined,
  issuer = 'hogaan-test',
  audience = 'aud-test',
): AppConfig {
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
    jwtSecretBase64: secret,
    jwtIssuer: issuer,
    jwtAudience: audience,
    anthropicApiKey: undefined,
    groqApiKey: undefined,
    voyageApiKey: undefined,
    twilioAccountSid: undefined,
    twilioAuthToken: undefined,
    twilioWhatsAppFrom: undefined,
    twilioWebhookAuthToken: undefined,
    sentryDsn: undefined,
    axiomToken: undefined,
    axiomDataset: undefined,
    betterstackHeartbeatUrl: undefined,
    resendApiKey: undefined,
    resendFromEmail: undefined,
    sponsorPortalBaseUrl: undefined,
  };
}

/** Minimal redis stub: in-memory revocation set with the methods token.ts touches. */
function fakeRedis() {
  const revoked = new Set<string>();
  return {
    revoked,
    bundle: {
      client: {
        sismember: (_set: string, jti: string) => Promise.resolve(revoked.has(jti) ? 1 : 0),
        sadd: (_set: string, jti: string) => {
          revoked.add(jti);
          return Promise.resolve(1);
        },
      },
      withTimeout: <T>(_op: string, _ms: number, fn: () => Promise<T>) => fn(),
    },
  };
}

describe('session token', () => {
  it('issues + verifies a valid token round-trip', async () => {
    resetTokenCacheForTests();
    const cfg = configWith(randomBytes(32).toString('base64'));
    const r = fakeRedis();
    const token = await issueSessionToken(cfg, {
      userId: asUserId('user-123'),
      jti: 'jti-abc',
      ttlSeconds: 60,
    });
    const v = await validateSessionToken(cfg, r.bundle as never, token);
    expect(v.userId).toBe('user-123');
    expect(v.jti).toBe('jti-abc');
    expect(v.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a tampered token', async () => {
    resetTokenCacheForTests();
    const cfg = configWith(randomBytes(32).toString('base64'));
    const r = fakeRedis();
    const token = await issueSessionToken(cfg, {
      userId: asUserId('user-123'),
      jti: 'jti-abc',
      ttlSeconds: 60,
    });
    // Flip a character in the signature segment.
    const parts = token.split('.');
    parts[2] = parts[2]!.slice(0, -2) + 'AA';
    const tampered = parts.join('.');
    await expect(validateSessionToken(cfg, r.bundle as never, tampered)).rejects.toBeInstanceOf(
      TokenInvalidError,
    );
  });

  it('rejects a token signed with a different secret', async () => {
    resetTokenCacheForTests();
    const cfgA = configWith(randomBytes(32).toString('base64'));
    const token = await issueSessionToken(cfgA, {
      userId: asUserId('user-123'),
      jti: 'jti-abc',
      ttlSeconds: 60,
    });
    resetTokenCacheForTests();
    const cfgB = configWith(randomBytes(32).toString('base64'));
    const r = fakeRedis();
    await expect(validateSessionToken(cfgB, r.bundle as never, token)).rejects.toBeInstanceOf(
      TokenInvalidError,
    );
  });

  it('rejects an expired token', async () => {
    resetTokenCacheForTests();
    const cfg = configWith(randomBytes(32).toString('base64'));
    const r = fakeRedis();
    const token = await issueSessionToken(cfg, {
      userId: asUserId('user-123'),
      jti: 'jti-abc',
      ttlSeconds: -10, // already expired
    });
    await expect(validateSessionToken(cfg, r.bundle as never, token)).rejects.toBeInstanceOf(
      TokenInvalidError,
    );
  });

  it('rejects a revoked token', async () => {
    resetTokenCacheForTests();
    const cfg = configWith(randomBytes(32).toString('base64'));
    const r = fakeRedis();
    const token = await issueSessionToken(cfg, {
      userId: asUserId('user-123'),
      jti: 'jti-revoked',
      ttlSeconds: 60,
    });
    r.revoked.add('jti-revoked');
    await expect(validateSessionToken(cfg, r.bundle as never, token)).rejects.toBeInstanceOf(
      TokenInvalidError,
    );
  });
});
