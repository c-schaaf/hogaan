import type { FastifyInstance } from 'fastify';
import { getDb } from '../shared/db/client.js';
import type { AppConfig } from '../shared/secrets/config.js';
import { registerWhatsAppRoutes } from './routes.js';

/**
 * Wire the Twilio webhook routes onto the running Fastify instance.
 *
 * Called from `src/index.ts main()` after `buildApp()`. Skips registration
 * silently when DATABASE_URL or PUBLIC_BASE_URL is missing — the dev server
 * still boots, just without the webhook endpoints. Production must have both
 * set or the wiring no-ops and Twilio will get 404s.
 */
export async function wireWhatsAppDeliveryRoutes(
  app: FastifyInstance,
  config: AppConfig,
): Promise<{ registered: boolean; reason?: string }> {
  if (config.databaseUrl === undefined) {
    return { registered: false, reason: 'DATABASE_URL not configured' };
  }
  if (config.publicBaseUrl === undefined) {
    return { registered: false, reason: 'PUBLIC_BASE_URL not configured' };
  }

  const { db } = getDb(config);
  await registerWhatsAppRoutes(app, { db, publicBaseUrl: config.publicBaseUrl });
  return { registered: true };
}
