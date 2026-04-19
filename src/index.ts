import { buildApp } from './app';
import { config }   from './config';

async function main() {
  const app = await buildApp();

  const address = await app.listen({
    port: config.PORT,
    host: '0.0.0.0',
  });

  app.log.info(`🚀  tcm.my.id API running on ${address}`);
  app.log.info(`📚  Swagger docs: ${address}/docs`);

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal} — shutting down...`);
    try {
      await app.close();
      app.log.info('Server closed cleanly.');
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
