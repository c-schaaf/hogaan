import { randomUUID } from 'node:crypto';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyError } from 'fastify';
import type { AppConfig } from './shared/secrets/config.js';
import { loggerOptionsFor } from './shared/observability/logger.js';

export async function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: loggerOptionsFor(config),
    disableRequestLogging: false,
    genReqId: (req) => {
      const inbound = req.headers['x-request-id'];
      if (typeof inbound === 'string' && inbound.length > 0 && inbound.length <= 128) {
        return inbound;
      }
      return randomUUID();
    },
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  app.decorate('config', config);

  // SCRUM-F7: security headers (Hard Rule defence-in-depth).
  //
  // Helmet sets HSTS, X-Frame-Options, Referrer-Policy and a few smaller
  // headers with secure defaults. The one bit that needs care is the
  // Content-Security-Policy: a too-strict CSP would block Vite's inline
  // bootstrap and break the SPA. We ship CSP in REPORT-ONLY mode for the
  // first deploy — the browser logs what would have been blocked but
  // doesn't actually block anything, so we can observe real traffic
  // against the policy before flipping to enforcement in a follow-up PR.
  //
  // Directives below are deliberately permissive (allow inline scripts +
  // styles; allow Supabase Auth origin for client SDK calls; block
  // everything else by default). Tighten in the follow-up.
  await app.register(helmet, {
    contentSecurityPolicy: {
      reportOnly: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        // Supabase Auth client SDK + Supabase realtime (websocket).
        connectSrc: ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    hsts: {
      maxAge: 31_536_000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    // Belt-and-suspenders with frameAncestors above. Some older browsers /
    // proxies respect this header but not CSP frame-ancestors.
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // Reduces risk of MIME-sniffing-based XSS.
    noSniff: true,
    // We don't need these headers for our use case; helmet's defaults are
    // fine but make them explicit so a future contributor sees the choice.
    xPoweredBy: false,
  });

  await app.register(sensible);

  app.addHook('onRequest', (req, reply, done) => {
    void reply.header('x-request-id', req.id);
    done();
  });

  app.get('/healthz', () => ({ status: 'ok' }));

  app.get('/readyz', async (_req, reply) => {
    // TODO Phase 1.10 / 2: replace with real DB + Redis ping once src/shared/db and src/shared/redis exist.
    const checks: Record<string, 'ok' | 'skip'> = {
      process: 'ok',
      db: 'skip',
      redis: 'skip',
    };
    return reply.send({ status: 'ok', checks });
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    req.log.error({ err }, 'unhandled request error');
    if (reply.sent) {
      return;
    }
    void reply.status(err.statusCode ?? 500).send({
      error: err.name || 'InternalServerError',
      message: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
      requestId: req.id,
    });
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }
}
