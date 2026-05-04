import { randomUUID } from 'node:crypto';
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
