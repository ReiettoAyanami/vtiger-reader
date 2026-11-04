import { openDatabase, type Database, type Row } from '../../src/db/database.js';
import { runMigrations } from '../../src/db/migrate.js';

/**
 * The tests' database (plan 7.3): SQLite in memory, one per test file (each file runs in its own
 * worker), made and migrated before its first test. Nothing outside the process is touched.
 */
let db: Database | null = null;
let migrated: Promise<string[]> | null = null;

export function testDb(): Database {
  db ??= openDatabase(':memory:');
  return db;
}

/** Brings the test database's tables up to date (once per file). */
export function prepareTestDb(): Promise<string[]> {
  migrated ??= runMigrations(testDb());
  return migrated;
}

export function closeTestDb(): void {
  db?.close();
  db = null;
  migrated = null;
}

/**
 * Empties every table except schema_migrations, and sets the ids back to 1: each test makes what it
 * needs (the local profile comes from setup.ts). The app itself never empties a table.
 */
export async function resetDatabase(): Promise<void> {
  const database = testDb();
  const [tables] = await database.query<Row[]>(
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT IN ('schema_migrations', 'sqlite_sequence') AND name NOT LIKE 'sqlite_%'`,
  );
  database.exec('PRAGMA foreign_keys = OFF');
  try {
    for (const t of tables) database.exec(`DELETE FROM "${String(t.name)}"`);
    database.exec('DELETE FROM sqlite_sequence');
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}

/** Raw row access for assertions; a statement that changes rows answers no rows. */
export async function rawRows(sql: string, values: unknown[] = []): Promise<Row[]> {
  const [result] = await testDb().query(sql, values);
  return Array.isArray(result) ? result : [];
}
