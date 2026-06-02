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
  sentryDsn: undefined,
  axiomToken: undefined,
  axiomDataset: undefined,
  betterstackHeartbeatUrl: undefined,
  resendApiKey: undefined,
  resendFromEmail: undefined,
  supabaseUrl: undefined,
  supabaseAnonKey: undefined,
  supabaseJwtSecret: undefined,
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

  /**
   * SCRUM-F7: defence-in-depth security headers. Helmet wires HSTS,
   * X-Frame-Options, Referrer-Policy, X-Content-Type-Options, and a
   * report-only CSP. These tests pin the headers we explicitly chose so
   * any future contributor who tries to weaken them (e.g. removing
   * helmet, or relaxing the CSP frame-ancestors) trips the suite.
   *
   * CSP is intentionally shipped in REPORT-ONLY mode for the first
   * deploy — the header name is `content-security-policy-report-only`,
   * not `content-security-policy`. The follow-up PR flips this to
   * enforcement after 24h of observation.
   */
  describe('security headers (SCRUM-F7)', () => {
    it('sets Strict-Transport-Security with 1-year max-age + includeSubDomains', async () => {
      const app = await buildApp(testConfig);
      try {
        const res = await app.inject({ method: 'GET', url: '/healthz' });
        const hsts = res.headers['strict-transport-security'];
        expect(typeof hsts).toBe('string');
        expect(hsts).toContain('max-age=31536000');
        expect(hsts).toContain('includeSubDomains');
      } finally {
        await app.close();
      }
    });

    it('sets X-Frame-Options: DENY to block clickjacking', async () => {
      const app = await buildApp(testConfig);
      try {
        const res = await app.inject({ method: 'GET', url: '/healthz' });
        expect(res.headers['x-frame-options']).toBe('DENY');
      } finally {
        await app.close();
      }
    });

    it('sets Referrer-Policy to strict-origin-when-cross-origin', async () => {
      const app = await buildApp(testConfig);
      try {
        const res = await app.inject({ method: 'GET', url: '/healthz' });
        expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      } finally {
        await app.close();
      }
    });

    it('sets X-Content-Type-Options: nosniff to block MIME-sniffing attacks', async () => {
      const app = await buildApp(testConfig);
      try {
        const res = await app.inject({ method: 'GET', url: '/healthz' });
        expect(res.headers['x-content-type-options']).toBe('nosniff');
      } finally {
        await app.close();
      }
    });

    it('sets CSP in report-only mode (header name is -Report-Only, not enforcing) for safe rollout', async () => {
      const app = await buildApp(testConfig);
      try {
        const res = await app.inject({ method: 'GET', url: '/healthz' });
        // First deploy: report-only. The enforce-mode header should NOT
        // be present yet — flipping to enforce is a follow-up PR.
        expect(res.headers['content-security-policy-report-only']).toBeTruthy();
        expect(res.headers['content-security-policy']).toBeUndefined();
      } finally {
        await app.close();
      }
    });

    it('CSP policy blocks iframe-embedding via frame-ancestors none', async () => {
      const app = await buildApp(testConfig);
      try {
        const res = await app.inject({ method: 'GET', url: '/healthz' });
        const csp = res.headers['content-security-policy-report-only'];
        expect(typeof csp).toBe('string');
        // Belt with X-Frame-Options DENY; suspenders here.
        expect(csp).toContain("frame-ancestors 'none'");
      } finally {
        await app.close();
      }
    });

    it('CSP policy allows Supabase Auth origin for the client SDK', async () => {
      const app = await buildApp(testConfig);
      try {
        const res = await app.inject({ method: 'GET', url: '/healthz' });
        const csp = res.headers['content-security-policy-report-only'];
        expect(typeof csp).toBe('string');
        // The web SPA calls supabase.auth.getSession() from the browser —
        // a too-strict connect-src would block that and break login.
        expect(csp).toContain('*.supabase.co');
      } finally {
        await app.close();
      }
    });

    it('does NOT leak server identity via X-Powered-By', async () => {
      const app = await buildApp(testConfig);
      try {
        const res = await app.inject({ method: 'GET', url: '/healthz' });
        expect(res.headers['x-powered-by']).toBeUndefined();
      } finally {
        await app.close();
      }
    });

    it('rejects request bodies larger than 256 KB with 413', async () => {
      const app = await buildApp(testConfig);
      try {
        const oversized = 'x'.repeat(300_000);
        const res = await app.inject({
          method: 'POST',
          url: '/healthz',
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify({ blob: oversized }),
        });
        expect(res.statusCode).toBe(413);
      } finally {
        await app.close();
      }
    });

    it.todo(
      'enforces CSP after the report-only window closes — content-security-policy is set, content-security-policy-report-only is unset',
    );
  });

  describe('/readyz', () => {
    it.todo('/readyz with real DB ping returns 200');
    it.todo('/readyz with DB ping throwing returns 503');
    it.todo('/readyz with Redis ping timing out returns degraded');
  });
});
