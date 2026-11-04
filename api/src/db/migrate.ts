import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database, Row } from './database.js';

/**
 * api/migrations, resolved from this file: works from src/db (tsx, vitest) and from dist/db
 * (compiled, inside the desktop app too).
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
 * Applies the pending migrations, in filename order, each in its own transaction, and records each
 * one in `schema_migrations` with it: a file that fails leaves nothing behind. One process owns the
 * database file (the desktop app), and BEGIN IMMEDIATE holds the write lock anyway.
 * Returns the versions applied by this call.
 */
export async function runMigrations(db: Database, options: MigrateOptions = {}): Promise<string[]> {
  const dir = options.dir ?? resolveMigrationsDir();
  const log = options.log ?? (() => undefined);
  const files = await listMigrationFiles(dir);
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    TEXT NOT NULL PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     )`,
  );
  const [rows] = await db.query<Row[]>('SELECT version FROM schema_migrations');
  const done = new Set(rows.map((r) => String(r.version)));
  const applied: string[] = [];
  for (const file of files) {
    // The version is the file's name without .sql: 001_init.
    const version = file.replace(/\.sql$/, '');
    if (done.has(version)) continue;
    const sql = await readFile(join(dir, file), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      await db.query('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
    }
    log(`applied ${version}`);
    applied.push(version);
  }
  return applied;
}
