import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { loggerOptionsFor } from '../../../src/shared/observability/logger.js';
import type { AppConfig } from '../../../src/shared/secrets/config.js';

function fakeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 0,
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
    voyageApiKey: undefined,
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

// Pinned snapshot of REDACT_PATHS as encoded in src/shared/observability/logger.ts.
// If a future PR adds, removes, or renames a path, this array MUST be updated
// in the same diff — making the change reviewer-visible (the SCRUM-F5 control).
//
// Each row carries: the redact path itself, the payload-shape used to build a
// log entry that triggers that path, and the JSON-path to the sentinel field
// in the produced log object.
interface RedactCase {
  readonly path: string;
  readonly payload: Record<string, unknown>;
}

function payloadFor(path: string, canary: string): Record<string, unknown> {
  switch (path) {
    case 'req.headers.authorization':
      return { req: { headers: { authorization: canary } } };
    case 'req.headers.cookie':
      return { req: { headers: { cookie: canary } } };
    case 'res.headers["set-cookie"]':
      return { res: { headers: { 'set-cookie': canary } } };
    case '*.phoneNumber':
      return { user: { phoneNumber: canary } };
    case '*.phone_number':
      return { user: { phone_number: canary } };
    case '*.email':
      return { user: { email: canary } };
    case '*.user_email':
      return { ctx: { user_email: canary } };
    case '*.userEmail':
      return { ctx: { userEmail: canary } };
    case '*.ANTHROPIC_API_KEY':
      return { env: { ANTHROPIC_API_KEY: canary } };
    case '*.GROQ_API_KEY':
      return { env: { GROQ_API_KEY: canary } };
    case '*.VOYAGE_API_KEY':
      return { env: { VOYAGE_API_KEY: canary } };
    default:
      throw new Error(`Unmapped REDACT path in test: ${path}`);
  }
}

const REDACT_CASES: readonly RedactCase[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.phoneNumber',
  '*.phone_number',
  '*.email',
  '*.user_email',
  '*.userEmail',
  '*.ANTHROPIC_API_KEY',
  '*.GROQ_API_KEY',
  '*.VOYAGE_API_KEY',
].map((path) => ({ path, payload: payloadFor(path, `SECRET-CANARY-${path}`) }));

function buildLoggerCapturing(lines: string[]): pino.Logger {
  const opts = loggerOptionsFor(fakeConfig());
  const stream = {
    write(chunk: string): void {
      lines.push(chunk);
    },
  };
  return pino(opts, stream);
}

describe('logger — REDACT_PATHS parametric scrubbing', () => {
  it('exposes the expected REDACT path count (locks the list size against silent shrinkage)', () => {
    expect(REDACT_CASES).toHaveLength(11);
  });

  describe.each(REDACT_CASES)('REDACT path: $path', ({ path, payload }) => {
    it(`removes the canary value set at ${path} from the serialized output`, () => {
      const lines: string[] = [];
      const logger = buildLoggerCapturing(lines);
      logger.info(payload, 'test log');

      expect(lines.length).toBeGreaterThan(0);
      const serialized = lines.join('');
      // SCRUM-F5 invariant: redact { remove: true } means the canary must not
      // appear ANYWHERE in the serialized payload, regardless of nesting.
      expect(serialized).not.toContain('SECRET-CANARY');
      expect(serialized).not.toContain(`SECRET-CANARY-${path}`);
    });
  });

  it('does NOT scrub unrelated fields — only listed REDACT_PATHS are removed', () => {
    const lines: string[] = [];
    const logger = buildLoggerCapturing(lines);
    logger.info({ harmless: 'visible-canary', user: { firstName: 'Asha' } }, 'plain');

    const serialized = lines.join('');
    expect(serialized).toContain('visible-canary');
    expect(serialized).toContain('Asha');
  });

  it('keeps the base service tag on every line (sanity check on loggerOptionsFor wiring)', () => {
    const lines: string[] = [];
    const logger = buildLoggerCapturing(lines);
    logger.info('plain message');

    const parsed = JSON.parse(lines[0] ?? '{}') as { service?: string; env?: string };
    expect(parsed.service).toBe('hogaan');
    expect(parsed.env).toBe('test');
  });
});
