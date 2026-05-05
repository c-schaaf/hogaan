import type { FastifyInstance } from 'fastify';
import { getDb } from '../shared/db/client.js';
import { getRedis } from '../shared/redis/client.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { registerSponsorPortalRoutes } from './routes.js';

/**
 * Phase 9A wiring. Mirrors whatsapp-delivery/setup.ts. Skips registration
 * silently if any of DATABASE_URL / Upstash / JWT_SECRET_BASE64 / a portal
 * base URL is missing — production must have the full set.
 */
export async function wireSponsorPortalRoutes(
  app: FastifyInstance,
  config: AppConfig,
): Promise<{ registered: boolean; reason?: string }> {
  if (config.databaseUrl === undefined) {
    return { registered: false, reason: 'DATABASE_URL not configured' };
  }
  if (config.upstashRedisRestUrl === undefined || config.upstashRedisRestToken === undefined) {
    return { registered: false, reason: 'UPSTASH_REDIS_REST_URL/_TOKEN not configured' };
  }
  if (config.jwtSecretBase64 === undefined) {
    return { registered: false, reason: 'JWT_SECRET_BASE64 not configured' };
  }
  if (config.sponsorPortalBaseUrl === undefined && config.publicBaseUrl === undefined) {
    return {
      registered: false,
      reason: 'SPONSOR_PORTAL_BASE_URL or PUBLIC_BASE_URL must be configured',
    };
  }

  const { db } = getDb(config);
  const redis = getRedis(config);

  await registerSponsorPortalRoutes(app, { config, db, redis });
  return { registered: true };
}
