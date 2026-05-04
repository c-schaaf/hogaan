import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { type AppConfig, ConfigError, requireConfig } from '../secrets/config.js';

/**
 * Application-layer column encryption. Plaintext PII (phone numbers, etc.) goes
 * through encrypt() before INSERT. The DB never sees plaintext and never has
 * the key — pgcrypto would require sending the key over the wire on every
 * decrypt, which we explicitly avoid.
 *
 * Format: AES-256-GCM, 12-byte IV, 16-byte auth tag.
 * Wire format: base64( iv(12) || authTag(16) || ciphertext(N) ).
 *
 * Key rotation: not implemented in v1. When we rotate, prepend a 1-byte version
 * tag and dispatch on it.
 */

const IV_LEN = 12;
const TAG_LEN = 16;
const ALG = 'aes-256-gcm';
const KEY_LEN = 32;

let cachedKey: Buffer | undefined;

function getKey(config: AppConfig): Buffer {
  if (cachedKey) {
    return cachedKey;
  }
  const b64 = requireConfig(config, 'encryptionKeyBase64');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== KEY_LEN) {
    throw new ConfigError(
      `ENCRYPTION_KEY_BASE64 must decode to ${KEY_LEN} bytes (got ${buf.length}). Generate with: openssl rand -base64 32`,
    );
  }
  cachedKey = buf;
  return buf;
}

export function encryptPlaintext(config: AppConfig, plaintext: string): string {
  const key = getKey(config);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export class DecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptError';
  }
}

export function decryptPlaintext(config: AppConfig, payload: string): string {
  const key = getKey(config);
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new DecryptError(`ciphertext too short: ${buf.length} bytes`);
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  try {
    const decipher = createDecipheriv(ALG, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (err) {
    throw new DecryptError(`auth tag verification failed: ${(err as Error).message}`);
  }
}

/**
 * SHA-256 hash of an E.164 phone, used as the user-resolution key everywhere.
 * Identity is keyed on this hash, never on plaintext. Caller is responsible
 * for normalizing the phone (Process #12 Step 2) before hashing.
 */
export function hashPhone(phoneE164: string): string {
  return createHash('sha256').update(phoneE164, 'utf8').digest('hex');
}

/** Reset cached key — tests only. */
export function resetEncryptionCache(): void {
  cachedKey = undefined;
}
