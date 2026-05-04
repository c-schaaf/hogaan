import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptPlaintext,
  DecryptError,
  encryptPlaintext,
  hashPhone,
  resetEncryptionCache,
} from '../../src/shared/db/encryption.js';
import { ConfigError, type AppConfig } from '../../src/shared/secrets/config.js';

function configWithKey(key: string | undefined): AppConfig {
  return {
    nodeEnv: 'test',
    port: 0,
    logLevel: 'error',
    databaseUrl: undefined,
    redisUrl: undefined,
    upstashRedisRestUrl: undefined,
    upstashRedisRestToken: undefined,
    encryptionKeyBase64: key,
    jwtSecretBase64: undefined,
    jwtIssuer: undefined,
    jwtAudience: undefined,
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
  };
}

describe('encryption', () => {
  it('round-trips plaintext through encrypt + decrypt', () => {
    resetEncryptionCache();
    const cfg = configWithKey(randomBytes(32).toString('base64'));
    const plain = '+252612345678';
    const ciphertext = encryptPlaintext(cfg, plain);
    expect(ciphertext).not.toBe(plain);
    expect(decryptPlaintext(cfg, ciphertext)).toBe(plain);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    resetEncryptionCache();
    const cfg = configWithKey(randomBytes(32).toString('base64'));
    const a = encryptPlaintext(cfg, 'same input');
    const b = encryptPlaintext(cfg, 'same input');
    expect(a).not.toBe(b);
    expect(decryptPlaintext(cfg, a)).toBe('same input');
    expect(decryptPlaintext(cfg, b)).toBe('same input');
  });

  it('rejects ciphertext tampered after the auth tag', () => {
    resetEncryptionCache();
    const cfg = configWithKey(randomBytes(32).toString('base64'));
    const ct = encryptPlaintext(cfg, 'do not modify');
    // Flip the last byte (last byte of ciphertext, which the auth tag covers).
    const buf = Buffer.from(ct, 'base64');
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
    const tampered = buf.toString('base64');
    expect(() => decryptPlaintext(cfg, tampered)).toThrow(DecryptError);
  });

  it('rejects a key of the wrong length', () => {
    resetEncryptionCache();
    const cfg = configWithKey(randomBytes(16).toString('base64')); // 16 bytes, not 32
    expect(() => encryptPlaintext(cfg, 'x')).toThrow(ConfigError);
  });

  it('hashPhone is deterministic and produces 64 hex chars', () => {
    const a = hashPhone('+252612345678');
    const b = hashPhone('+252612345678');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPhone('+252612345679')).not.toBe(a);
  });
});
