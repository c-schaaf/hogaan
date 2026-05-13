import 'dotenv/config';
import { buildApp } from './app.js';
import { loadConfig } from './shared/secrets/config.js';
import { initSentry, shutdownSentry, startHeartbeat } from './shared/observability/index.js';
import { wireSponsorPortalRoutes } from './sponsor-portal/setup.js';
import { wireWebApiRoutes } from './web-api/setup.js';
import { wireWebStatic } from './web-static/setup.js';
import { wireWhatsAppDeliveryRoutes } from './whatsapp-delivery/setup.js';

// DEBUG INSTRUMENTATION — startup probes. Bypass pino entirely (writes
// to stderr via console.warn) so we localize WHERE on Render startup
// hangs even if the logger itself is silent. Remove with the rest of
// the debug branch once production silent-failure is identified.
//
// ESM imports are hoisted, so by the time this `startupProbe` definition
// is evaluated, ALL imports above have already resolved. The first probe
// firing means: imports completed cleanly, module-evaluation reached
// this point. If you see NO probe lines on Render, the hang is during
// module-import resolution (one of the five imports above transitively
// blocks).
const startupProbe = (m: string): void => {
  try {
    console.warn(`[STARTUP] ${new Date().toISOString()} ${m}`);
  } catch {
    /* never throw from a probe */
  }
};
startupProbe('imports resolved — module evaluation reached the probe definition');

async function main(): Promise<void> {
  startupProbe('main() entered');
  const config = loadConfig();
  startupProbe(`loadConfig() returned (NODE_ENV=${config.nodeEnv}, port=${config.port})`);
  initSentry(config);
  startupProbe('initSentry() returned');

  const app = await buildApp(config);
  startupProbe('buildApp() returned');
  const wired = await wireWhatsAppDeliveryRoutes(app, config);
  startupProbe(
    `wireWhatsAppDeliveryRoutes() returned (registered=${wired.registered}, reason=${wired.reason ?? 'ok'})`,
  );
  app.log.info(
    { whatsappRoutes: wired.registered, reason: wired.reason ?? 'ok' },
    'whatsapp delivery routes',
  );
  const portalWired = await wireSponsorPortalRoutes(app, config);
  startupProbe(
    `wireSponsorPortalRoutes() returned (registered=${portalWired.registered}, reason=${portalWired.reason ?? 'ok'})`,
  );
  app.log.info(
    { sponsorPortalRoutes: portalWired.registered, reason: portalWired.reason ?? 'ok' },
    'sponsor portal routes',
  );
  // End-user web auth is handled by Supabase Auth in the browser. The
  // backend just validates the `Authorization: Bearer <supabase-token>`
  // header on /api/* via web-api/supabase-session.ts middleware.
  const webApiWired = await wireWebApiRoutes(app, config);
  app.log.info(
    { webApiRoutes: webApiWired.registered, reason: webApiWired.reason ?? 'ok' },
    'web api routes',
  );
  // Static SPA serve — must come LAST so it doesn't claim API/webhook paths.
  const staticWired = await wireWebStatic(app, config);
  app.log.info(
    { webStatic: staticWired.registered, reason: staticWired.reason ?? 'ok' },
    'web static (SPA)',
  );
  const heartbeat = startHeartbeat(config);
  startupProbe('startHeartbeat() returned');

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
    startupProbe(`app.listen() about to be called on port=${config.port}`);
    await app.listen({ host: '0.0.0.0', port: config.port });
    startupProbe('app.listen() resolved — server is up');
  } catch (err) {
    startupProbe(`app.listen() THREW: ${err instanceof Error ? err.message : String(err)}`);
    app.log.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

startupProbe('about to call main()');
main().catch((err: unknown) => {
  startupProbe(
    `main() REJECTED: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
  );
  console.error('fatal startup error', err);
  process.exit(1);
});
