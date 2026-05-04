import { buildApp } from './app.js';
import { loadConfig } from './shared/secrets/config.js';
import { initSentry, shutdownSentry, startHeartbeat } from './shared/observability/index.js';

async function main(): Promise<void> {
  const config = loadConfig();
  initSentry(config);

  const app = await buildApp(config);
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
