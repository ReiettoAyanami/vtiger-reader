import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { buildApp, type BuildAppOptions } from './app.js';
import { openDatabase } from './db/database.js';
import { runMigrations } from './db/migrate.js';
import { ensureLocalProfile } from './modules/profile/profile.js';

export interface StartOptions extends Omit<BuildAppOptions, 'db' | 'logger'> {
  /** The SQLite file; made with its folder at the first start. */
  dbFile: string;
  /** Where to listen: this PC only (127.0.0.1) for the desktop app. Port 0: any free one. */
  host: string;
  port: number;
  logger?: FastifyServerOptions['logger'];
  migrationsDir?: string | undefined;
}

export interface Started {
  app: FastifyInstance;
  /** The address it listens at, e.g. http://127.0.0.1:52411. */
  url: string;
}

/**
 * Starts the app (plan 7.3, 7.4): opens the database, brings its tables up to date, makes the
 * profile at the first start, listens, and starts the checks for new tickets. Used by the bare dev
 * server (server.ts) and by the desktop app. Closing the app closes the database.
 */
export async function startApi(opts: StartOptions): Promise<Started> {
  const { dbFile, host, port, logger, migrationsDir, ...appOptions } = opts;
  const db = openDatabase(dbFile);
  let app: FastifyInstance | undefined;
  try {
    const applied = await runMigrations(db, { dir: migrationsDir });
    app = await buildApp({ ...appOptions, db, logger: logger ?? false });
    app.addHook('onClose', async () => db.close());
    if (applied.length > 0) app.log.info(`applied migrations: ${applied.join(', ')}`);
    if (await ensureLocalProfile(db)) app.log.info('created the local profile');
    const url = await app.listen({ host, port });
    if (appOptions.webDist) app.log.info(`serving the web build from ${appOptions.webDist}`);
    // New tickets, every 2 minutes (plan 5.1), while the app runs.
    app.notifications.start();
    return { app, url };
  } catch (err) {
    if (app) await app.close().catch(() => undefined);
    else db.close();
    throw err;
  }
}
