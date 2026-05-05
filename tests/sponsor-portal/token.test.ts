import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  issueMagicLinkToken,
  issueSponsorSessionToken,
  validateMagicLinkToken,
  validateSponsorSessionToken,
} from '../../src/sponsor-portal/auth/token.js';
import { TokenInvalidError } from '../../src/identity/token.js';
import { resetTokenCacheForTests } from '../../src/identity/token.js';
import type { AppConfig } from '../../src/shared/secrets/config.js';
import type { RedisBundle } from '../../src/shared/redis/client.js';

function makeTestConfig(jwtSecretBase64: string): AppConfig {
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
    jwtSecretBase64,
    jwtIssuer: 'hogaan-test',
    jwtAudience: 'hogaan-sponsor-portal-test',
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

function makeRedisStub(): RedisBundle {
  const set = new Set<string>();
  const client = {
    sismember: (_key: string, m: string) => Promise.resolve(set.has(m) ? 1 : 0),
    sadd: (_key: string, m: string) => {
      set.add(m);
      return Promise.resolve(1);
    },
  };
  const stub = {
    client,
    withTimeout: <T>(_op: string, _ms: number, fn: () => Promise<T>) => fn(),
  };
  return stub as unknown as RedisBundle;
}

const SECRET = Buffer.from('a'.repeat(64), 'utf8').toString('base64');

describe('sponsor-portal token wrapper', () => {
  beforeEach(() => {
    resetTokenCacheForTests();
  });
  afterEach(() => {
    resetTokenCacheForTests();
  });

  it('round-trips a magic-link token with kind enforcement', async () => {
    const config = makeTestConfig(SECRET);
    const redis = makeRedisStub();
    const token = await issueMagicLinkToken(config, {
      sponsorUserId: '11111111-2222-3333-4444-555555555555',
      email: 'admin@example.com',
    });
    const claims = await validateMagicLinkToken(config, redis, token);
    expect(claims.email).toBe('admin@example.com');
    expect(claims.sponsorUserId).toBe('11111111-2222-3333-4444-555555555555');
    expect(claims.jti).toMatch(/^mlnk-/);
  });

  it('rejects a session token presented at the magic-link endpoint', async () => {
    const config = makeTestConfig(SECRET);
    const redis = makeRedisStub();
    const sessionToken = await issueSponsorSessionToken(config, {
      sponsorUserId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      role: 'sponsor_admin',
      sponsorId: 'cccccccc-dddd-eeee-ffff-000000000000',
      email: 'admin@example.com',
    });
    await expect(validateMagicLinkToken(config, redis, sessionToken)).rejects.toBeInstanceOf(
      TokenInvalidError,
    );
  });

  it('rejects a magic-link token presented at the session endpoint', async () => {
    const config = makeTestConfig(SECRET);
    const redis = makeRedisStub();
    const magic = await issueMagicLinkToken(config, {
      sponsorUserId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      email: 'admin@example.com',
    });
    await expect(validateSponsorSessionToken(config, redis, magic)).rejects.toBeInstanceOf(
      TokenInvalidError,
    );
  });

  it('round-trips a sponsor_admin session token with sponsorId + role', async () => {
    const config = makeTestConfig(SECRET);
    const redis = makeRedisStub();
    const token = await issueSponsorSessionToken(config, {
      sponsorUserId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      role: 'sponsor_admin',
      sponsorId: 'cccccccc-dddd-eeee-ffff-000000000000',
      email: 'admin@example.com',
    });
    const claims = await validateSponsorSessionToken(config, redis, token);
    expect(claims.role).toBe('sponsor_admin');
    expect(claims.sponsorId).toBe('cccccccc-dddd-eeee-ffff-000000000000');
    expect(claims.email).toBe('admin@example.com');
  });

  it('round-trips a hogaan_ops token with null sponsorId', async () => {
    const config = makeTestConfig(SECRET);
    const redis = makeRedisStub();
    const token = await issueSponsorSessionToken(config, {
      sponsorUserId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      role: 'hogaan_ops',
      sponsorId: null,
      email: 'ops@example.com',
    });
    const claims = await validateSponsorSessionToken(config, redis, token);
    expect(claims.role).toBe('hogaan_ops');
    expect(claims.sponsorId).toBeNull();
  });

  it('rejects when revocation set contains the jti', async () => {
    const config = makeTestConfig(SECRET);
    const redis = makeRedisStub();
    const token = await issueMagicLinkToken(config, {
      sponsorUserId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      email: 'admin@example.com',
    });
    const claims = await validateMagicLinkToken(config, redis, token);
    // Revoke and re-validate.
    await redis.client.sadd('token:revoked', claims.jti);
    await expect(validateMagicLinkToken(config, redis, token)).rejects.toBeInstanceOf(
      TokenInvalidError,
    );
  });

  it('rejects malformed token', async () => {
    const config = makeTestConfig(SECRET);
    const redis = makeRedisStub();
    await expect(validateMagicLinkToken(config, redis, 'not.a.jwt')).rejects.toBeInstanceOf(
      TokenInvalidError,
    );
  });
});
