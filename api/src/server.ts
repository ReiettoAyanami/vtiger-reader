import { loadConfig } from './config.js';
import { startApi } from './start.js';

/**
 * The bare server, for development (`npm run dev`, with `ng serve` in front): the app without its
 * desktop window, on this PC only. Its notifications go to the log. The desktop app starts the same
 * app from its own main process (src/desktop/main.ts).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const { app } = await startApi({
    dbFile: config.dbFile,
    host: config.host,
    port: config.port,
    logger: { level: config.logLevel },
    webDist: config.webDist,
    migrationsDir: config.migrationsDir,
  });

  const shutdown = (signal: string) => {
    app.log.info(`${signal} received, closing`);
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, 'error while closing');
        process.exit(1);
      },
    );
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  console.error('startup failed:', err);
  process.exit(1);
});
