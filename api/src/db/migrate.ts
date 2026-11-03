import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2/promise';
import type { DbConfig } from '../config.js';

/**
 * api/migrations, resolved from this file: works from src/db (tsx, vitest) and from
 * dist/db (compiled, /app/dist/db -> /app/migrations in the prod image).
 */
export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

/** MIGRATIONS_DIR when set (relative paths resolve from the working directory), else api/migrations. */
export function resolveMigrationsDir(env: Record<string, string | undefined> = process.env): string {
  const override = env.MIGRATIONS_DIR?.trim();
  return override ? resolve(override) : DEFAULT_MIGRATIONS_DIR;
}

const MIGRATION_FILE = /^\d+_[A-Za-z0-9_.-]*\.sql$/;

export interface MigrateOptions {
  /** Folder with the numbered .sql files. Defaults to MIGRATIONS_DIR or api/migrations. */
  dir?: string | undefined;
  log?: (message: string) => void;
}

/** Numbered migration files, in filename order (001_…, 002_…). */
export async function listMigrationFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((f) => MIGRATION_FILE.test(f)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Creates the database DB_NAME when the server does not have it yet (a new installation on a MySQL
 * of one's own), so the migrations can then create its tables. Runs on a connection with no
 * database chosen. A database the user can already see (any privilege on it) is left alone, so a
 * user with table privileges only, on a database made by its administrator, works too.
 * The MySQL user is never created here: that takes root, which the app never holds.
 * Returns true when it created the database.
 */
export async function ensureDatabase(db: DbConfig): Promise<boolean> {
  const conn = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    charset: 'utf8mb4',
    connectTimeout: 5_000,
  });
  try {
    const [rows] = await conn.query<RowDataPacket[]>(
      'SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
      [db.database],
    );
    if (rows.length > 0) return false;
    try {
      await conn.query(`CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(db.database)} CHARACTER SET utf8mb4`);
    } catch (err) {
      if ((err as { code?: unknown }).code !== 'ER_DBACCESS_DENIED_ERROR') throw err;
      throw new Error(
        `The database "${db.database}" does not exist (or "${db.user}" has no privilege on it) and "${db.user}" ` +
          `cannot create it. As a MySQL administrator, run: GRANT ALL ON ${mysql.escapeId(db.database)}.* TO ` +
          `'${db.user}'@'%'; (or create the database and grant the user its privileges)`,
        { cause: err },
      );
    }
    return true;
  } finally {
    await conn.end().catch(() => undefined);
  }
}

/**
 * Applies the pending migrations, in filename order, and records each one in
 * `schema_migrations` after it succeeds. Runs on its own connection with
 * multipleStatements (a migration file is a script), under a server-wide named lock so two
 * API processes starting together cannot apply the same file twice.
 * Returns the versions applied by this call.
 */
export async function runMigrations(db: DbConfig, options: MigrateOptions = {}): Promise<string[]> {
  const dir = options.dir ?? resolveMigrationsDir();
  const log = options.log ?? (() => undefined);
  const files = await listMigrationFiles(dir);
  const lockName = `vtiger-reader:migrate:${db.database}`;

  const conn = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
    timezone: 'Z',
    charset: 'utf8mb4',
    multipleStatements: true,
    connectTimeout: 5_000,
  });
  try {
    await conn.query("SET time_zone = '+00:00'");
    const [lock] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, 60) AS got', [lockName]);
    if (Number(lock[0]?.got) !== 1) {
      throw new Error(`Could not acquire the migration lock "${lockName}" within 60 s`);
    }
    try {
      await conn.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           version    VARCHAR(255) NOT NULL PRIMARY KEY,
           applied_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
         ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4`,
      );
      const [rows] = await conn.query<RowDataPacket[]>('SELECT version FROM schema_migrations');
      const applied = new Set(rows.map((r) => String(r.version)));

      const done: string[] = [];
      for (const file of files) {
        const version = file.replace(/\.sql$/, '');
        if (applied.has(version)) continue;
        const sql = await readFile(join(dir, file), 'utf8');
        log(`applying migration ${file}`);
        // Foreign keys may reference tables created later in the same file.
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        try {
          if (sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').trim() !== '') {
            await conn.query(sql);
          }
        } finally {
          await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        }
        await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
        done.push(version);
      }
      if (done.length === 0) log('database schema is up to date');
      return done;
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => undefined);
    }
  } finally {
    await conn.end().catch(() => undefined);
  }
}
