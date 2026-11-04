import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openDatabase, type Database, type Row } from '../../src/db/database.js';
import { DEFAULT_MIGRATIONS_DIR, listMigrationFiles, resolveMigrationsDir, runMigrations } from '../../src/db/migrate.js';
import { rawRows, testDb } from '../support/db.js';

async function all(db: Database, sql: string): Promise<Row[]> {
  return (await db.query<Row[]>(sql))[0];
}

describe('migrations', () => {
  it('finds the numbered files in api/migrations, or in MIGRATIONS_DIR when set', async () => {
    expect(await listMigrationFiles(DEFAULT_MIGRATIONS_DIR)).toContain('001_init.sql');
    // test/db -> <api root>/migrations, the same folder src/db and dist/db resolve to
    expect(DEFAULT_MIGRATIONS_DIR).toBe(fileURLToPath(new URL('../../migrations/', import.meta.url)));
    expect(resolveMigrationsDir({})).toBe(DEFAULT_MIGRATIONS_DIR);
    expect(resolveMigrationsDir({ MIGRATIONS_DIR: '/opt/migrations' })).toBe(resolve('/opt/migrations'));
  });

  it('records applied files in schema_migrations and applies nothing twice', async () => {
    const rows = await rawRows('SELECT version, applied_at FROM schema_migrations ORDER BY version');
    expect(rows.map((r) => r.version)).toContain('001_init');
    expect(await runMigrations(testDb())).toEqual([]);
  });

  it('a migration that fails leaves nothing behind, and is not recorded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vtiger-reader-migrations-'));
    const db = openDatabase(':memory:');
    try {
      await writeFile(join(dir, '001_one.sql'), 'CREATE TABLE one (id INTEGER PRIMARY KEY);');
      await writeFile(join(dir, '002_two.sql'), 'CREATE TABLE two (id INTEGER PRIMARY KEY); INSERT INTO nowhere VALUES (1);');
      await expect(runMigrations(db, { dir })).rejects.toThrow(/002_two\.sql failed/);
      const tables = (await all(db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((t) => t.name);
      expect(tables).toContain('one');
      expect(tables).not.toContain('two');
      expect((await all(db, 'SELECT version FROM schema_migrations')).map((r) => r.version)).toEqual(['001_one']);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates the tables; UNIQUE keys only for one row per profile, never on a name", async () => {
    const tables = await rawRows("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'sqlite_sequence' ORDER BY name");
    // The profile and its preferences only: nothing the CRM already holds (lenzi, 2026-11-03).
    expect(tables.map((t) => t.name)).toEqual([
      'ai_provider',
      'ai_task_model',
      'ai_usage',
      'crm_link',
      'image_mark',
      'notification_state',
      'schema_migrations',
      'ticket_list',
      'user_settings',
      'users',
    ]);
    const unique: string[] = [];
    const fks: string[] = [];
    for (const { name } of tables) {
      const table = String(name);
      for (const index of await rawRows(`PRAGMA index_list("${table}")`)) {
        if (Number(index.unique) !== 1 || index.origin === 'pk') continue;
        for (const column of await rawRows(`PRAGMA index_info("${String(index.name)}")`)) unique.push(`${table}.${String(column.name)}`);
      }
      for (const fk of await rawRows(`PRAGMA foreign_key_list("${table}")`)) fks.push(`${table}.${String(fk.from)}->${String(fk.table)}`);
    }
    expect(unique.sort()).toEqual([
      'ai_task_model.task',
      'ai_task_model.user_id',
      'ai_usage.day',
      'ai_usage.kind',
      'ai_usage.model',
      'ai_usage.task',
      'ai_usage.user_id',
      'crm_link.user_id',
      'image_mark.exact_hash',
      'image_mark.user_id',
      'notification_state.user_id',
      'user_settings.user_id',
    ]);
    expect(fks.sort()).toEqual([
      'ai_provider.user_id->users',
      'ai_task_model.provider_id->ai_provider',
      'ai_task_model.user_id->users',
      'ai_usage.user_id->users',
      'crm_link.user_id->users',
      'image_mark.user_id->users',
      'notification_state.user_id->users',
      'ticket_list.user_id->users',
      'user_settings.user_id->users',
    ]);
  });

  it('the stored instants are UTC, with milliseconds', async () => {
    const [row] = await rawRows('SELECT created_at FROM users');
    expect(String(row?.created_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('the database file', () => {
  it('made with its folder; foreign keys enforced; written ahead (WAL)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vtiger-reader-db-'));
    const db = openDatabase(join(dir, 'nested', 'app.db'));
    try {
      expect((await all(db, 'PRAGMA foreign_keys'))[0]?.foreign_keys).toBe(1);
      expect((await all(db, 'PRAGMA journal_mode'))[0]?.journal_mode).toBe('wal');
      await runMigrations(db);
      await expect(db.query('INSERT INTO user_settings (user_id) VALUES (42)')).rejects.toThrow(/FOREIGN KEY/);
    } finally {
      db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
