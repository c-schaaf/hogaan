import { buildApp } from './app.js';
import { loadConfig } from './shared/secrets/config.js';
import { initSentry, shutdownSentry, startHeartbeat } from './shared/observability/index.js';
import { wireSponsorPortalRoutes } from './sponsor-portal/setup.js';
import { wireWhatsAppDeliveryRoutes } from './whatsapp-delivery/setup.js';

async function main(): Promise<void> {
  const config = loadConfig();
  initSentry(config);

  const app = await buildApp(config);
  const wired = await wireWhatsAppDeliveryRoutes(app, config);
  app.log.info(
    { whatsappRoutes: wired.registered, reason: wired.reason ?? 'ok' },
    'whatsapp delivery routes',
  );
  const portalWired = await wireSponsorPortalRoutes(app, config);
  app.log.info(
    { sponsorPortalRoutes: portalWired.registered, reason: portalWired.reason ?? 'ok' },
    'sponsor portal routes',
  );
  const heartbeat = startHeartbeat(config);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutdown signal received');
    heartbeat.stop();
    try {
      await app.close();
      await shutdownSentry();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ host: '0.0.0.0', port: config.port });
  } catch (err) {
    app.log.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('fatal startup error', err);
  process.exit(1);
});
