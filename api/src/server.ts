import type { FastifyBaseLogger } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig, type AppConfig } from './config.js';
import { ensureDatabase, runMigrations } from './db/migrate.js';
import { createPool } from './db/pool.js';
import { ensureFirstAdmin } from './modules/accounts/first-admin.js';

/** Connection errors worth waiting for while MySQL is still starting. */
const RETRYABLE = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR',
]);
const MAX_ATTEMPTS = 30;

async function migrateWithRetry(config: AppConfig, log: FastifyBaseLogger): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      // A new installation on a MySQL of one's own: the database first, then its tables.
      if (await ensureDatabase(config.db)) log.info(`created database ${config.db.database}`);
      const applied = await runMigrations(config.db, { dir: config.migrationsDir, log: (m) => log.info(m) });
      if (applied.length > 0) log.info(`applied migrations: ${applied.join(', ')}`);
      return;
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      if (typeof code !== 'string' || !RETRYABLE.has(code) || attempt >= MAX_ATTEMPTS) throw err;
      log.warn(`database not reachable yet (${code}), retry ${attempt}/${MAX_ATTEMPTS} in 2 s`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.db);
  const app = await buildApp({ pool, logger: { level: config.logLevel }, webDist: config.webDist });
  app.addHook('onClose', async () => {
    await pool.end();
  });

  try {
    await migrateWithRetry(config, app.log);
    // The first administrator, while there is none (design-accounts.md, "first account"). An
    // instance nobody can sign in to is of no use: when it cannot be created, the start stops here,
    // the reason in the log, and the container's restart tries again after .env is fixed.
    const firstAdmin = await ensureFirstAdmin({ pool, accounts: app.accounts, log: app.log }, config.firstAdmin);
    if (firstAdmin === 'failed') throw new Error('the first administrator could not be created (see the error above)');
    await app.listen({ host: config.host, port: config.port });
    if (config.webDist) app.log.info(`serving the web build from ${config.webDist}`);
  } catch (err) {
    app.log.fatal({ err }, 'startup failed');
    await app.close().catch(() => undefined);
    process.exit(1);
  }

  // Node is PID 1 in the container: handle the stop signals explicitly.
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
  console.error(err);
  process.exit(1);
});
