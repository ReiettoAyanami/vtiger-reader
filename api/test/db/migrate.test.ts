import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIGRATIONS_DIR,
  ensureDatabase,
  listMigrationFiles,
  resolveMigrationsDir,
  runMigrations,
} from '../../src/db/migrate.js';
import { rawRows, testDbConfig } from '../support/db.js';

/** Runs one migration file again on the test database, as the runner would. */
async function rerun(file: string): Promise<void> {
  const sql = await readFile(join(DEFAULT_MIGRATIONS_DIR, file), 'utf8');
  const conn = await mysql.createConnection({ ...testDbConfig(), multipleStatements: true });
  try {
    await conn.query(sql);
  } finally {
    await conn.end();
  }
}

describe('migrations', () => {
  it('finds the numbered files in api/migrations, or in MIGRATIONS_DIR when set', async () => {
    expect(await listMigrationFiles(DEFAULT_MIGRATIONS_DIR)).toContain('001_accounts.sql');
    // test/db -> <api root>/migrations, the same folder src/db and dist/db resolve to
    expect(DEFAULT_MIGRATIONS_DIR).toBe(fileURLToPath(new URL('../../migrations/', import.meta.url)));
    expect(resolveMigrationsDir({})).toBe(DEFAULT_MIGRATIONS_DIR);
    expect(resolveMigrationsDir({ MIGRATIONS_DIR: '/opt/migrations' })).toBe(resolve('/opt/migrations'));
  });

  it('records applied files in schema_migrations and applies nothing twice', async () => {
    const rows = await rawRows('SELECT version, applied_at FROM schema_migrations ORDER BY version');
    expect(rows.map((r) => r.version)).toContain('001_accounts');
    expect(await runMigrations(testDbConfig())).toEqual([]);
  });

  it('every migration is written to be safe to re-run, and running it again changes nothing', async () => {
    for (const file of await listMigrationFiles(DEFAULT_MIGRATIONS_DIR)) {
      const code = (await readFile(join(DEFAULT_MIGRATIONS_DIR, file), 'utf8')).replace(/--[^\n]*/g, '');
      expect(code, file).not.toMatch(/^\s*USE\s/im);
      expect(code.match(/CREATE TABLE(?! IF NOT EXISTS)/g), file).toBeNull();
      await rerun(file);
    }
  });

  it("creates the tables; UNIQUE keys only on a user's username and email, one settings row, one CRM link and one notification state per user, three technical keys", async () => {
    const tables = await rawRows(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`,
    );
    // Users and their preferences only: nothing the CRM already holds (lenzi, 2026-11-03).
    expect(tables.map((t) => t.name)).toEqual([
      'accounts',
      'ai_provider',
      'ai_task_model',
      'ai_usage',
      'crm_link',
      'image_mark',
      'notification_state',
      'password_history',
      'push_subscription',
      'push_vapid',
      'rate_limits',
      'schema_migrations',
      'sessions',
      'sign_in_failures',
      'ticket_list',
      'user_settings',
      'users',
      'verifications',
    ]);
    const unique = await rawRows(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE = 0 AND INDEX_NAME <> 'PRIMARY'
        ORDER BY TABLE_NAME, COLUMN_NAME`,
    );
    expect(unique.map((u) => `${u.t}.${u.c}`)).toEqual([
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
      'push_subscription.endpoint_hash',
      'rate_limits.key',
      'sessions.token',
      'user_settings.user_id',
      'users.email',
      'users.username',
    ]);
    const fks = await rawRows(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, REFERENCED_TABLE_NAME AS r FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME, COLUMN_NAME`,
    );
    expect(fks.map((f) => `${f.t}.${f.c}->${f.r}`)).toEqual([
      'accounts.user_id->users',
      'ai_provider.user_id->users',
      'ai_task_model.provider_id->ai_provider',
      'ai_task_model.user_id->users',
      'ai_usage.user_id->users',
      'crm_link.user_id->users',
      'image_mark.user_id->users',
      'notification_state.user_id->users',
      'password_history.user_id->users',
      'push_subscription.user_id->users',
      'sessions.impersonated_by->users',
      'sessions.user_id->users',
      'sign_in_failures.user_id->users',
      'ticket_list.user_id->users',
      'user_settings.user_id->users',
    ]);
  });

  it('the session and the stored instants are UTC', async () => {
    const [row] = await rawRows('SELECT @@session.time_zone AS tz');
    expect(row?.tz).toBe('+00:00');
  });
});

describe('ensureDatabase', () => {
  // A user with the right to create databases: root, only where the tests are given its password
  // (TEST_DB_ROOT_PASSWORD: the CI, the dev container).
  const rootPassword = process.env.TEST_DB_ROOT_PASSWORD?.trim();
  const scratch = 'vtiger_reader_ensure_test';

  it('leaves alone a database the user can already see', async () => {
    expect(await ensureDatabase(testDbConfig())).toBe(false);
  });

  it('says which GRANT is missing when the user may not create the database', async () => {
    const config = { ...testDbConfig(), database: 'vtiger_reader_not_granted_test' };
    const error = await ensureDatabase(config).then(() => null, (err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(`cannot create it`);
    expect((error as Error).message).toContain(`GRANT ALL ON \`vtiger_reader_not_granted_test\`.* TO '${config.user}'@'%'`);
  });

  it.skipIf(!rootPassword)('creates a missing database, utf8mb4, and the migrations can then fill it', async () => {
    const root = { ...testDbConfig(), user: 'root', password: rootPassword ?? '', database: scratch };
    const admin = await mysql.createConnection({ ...root, database: undefined });
    try {
      await admin.query(`DROP DATABASE IF EXISTS \`${scratch}\``);
      expect(await ensureDatabase(root)).toBe(true);
      const [rows] = await admin.query<mysql.RowDataPacket[]>(
        'SELECT DEFAULT_CHARACTER_SET_NAME AS cs FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
        [scratch],
      );
      expect(rows[0]?.cs).toBe('utf8mb4');
      expect(await runMigrations(root)).toContain('001_accounts');
      expect(await ensureDatabase(root)).toBe(false);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS \`${scratch}\``);
      await admin.end();
    }
  });
});
