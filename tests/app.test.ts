import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/shared/secrets/config.js';

const testConfig: AppConfig = {
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
    supabaseUrl: undefined,
    supabaseAnonKey: undefined,
};

describe('app', () => {
  it('responds 200 on /healthz', async () => {
    const app = await buildApp(testConfig);
    try {
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('responds 200 on /readyz with skip checks for unwired deps', async () => {
    const app = await buildApp(testConfig);
    try {
      const res = await app.inject({ method: 'GET', url: '/readyz' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ status: string; checks: Record<string, string> }>();
      expect(body.status).toBe('ok');
      expect(body.checks['process']).toBe('ok');
      expect(body.checks['db']).toBe('skip');
      expect(body.checks['redis']).toBe('skip');
    } finally {
      await app.close();
    }
  });

  it('echoes inbound x-request-id header back on response', async () => {
    const app = await buildApp(testConfig);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { 'x-request-id': 'test-req-abc-123' },
      });
      expect(res.headers['x-request-id']).toBe('test-req-abc-123');
    } finally {
      await app.close();
    }
  });

  it('generates a request id when none is provided', async () => {
    const app = await buildApp(testConfig);
    try {
      const res = await app.inject({ method: 'GET', url: '/healthz' });
      const reqId = res.headers['x-request-id'];
      expect(typeof reqId).toBe('string');
      if (typeof reqId === 'string') {
        expect(reqId.length).toBeGreaterThan(0);
      }
    } finally {
      await app.close();
    }
  });
});
