import type { RowDataPacket } from 'mysql2/promise';
import { loadConfig, type DbConfig } from '../../src/config.js';
import { createPool, type Pool } from '../../src/db/pool.js';

/**
 * The test database: TEST_DB_NAME, or `${DB_NAME}_test`. Refuses any name that does not
 * end with `_test`, so a misconfigured environment can never truncate the real database.
 */
export function testDbConfig(): DbConfig {
  const config = loadConfig();
  const database = config.testDbName;
  if (!database.endsWith('_test')) {
    throw new Error(`Refusing to run the tests against "${database}": the test database name must end with _test`);
  }
  return { ...config.db, database };
}

let pool: Pool | null = null;

export function testPool(): Pool {
  pool ??= createPool(testDbConfig(), { connectionLimit: 5 });
  return pool;
}

export async function closeTestPool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

/**
 * Empties every table except schema_migrations (users and their settings included: each test makes
 * the users it needs, see session.ts). Emptying the test database is fine; the app itself never
 * deletes a row of the domain.
 * Only the tables written to since their last reset are emptied (their AUTO_INCREMENT moved), with
 * DELETE and the counter set back to 1: ~30 ms a table against ~90 for a TRUNCATE (measured
 * 2026-10-03). Every table still starts empty, its ids from 1.
 */
export async function resetDatabase(): Promise<void> {
  const conn = await testPool().getConnection();
  try {
    // Fresh numbers, not the dictionary's cached ones.
    await conn.query('SET SESSION information_schema_stats_expiry = 0');
    const [tables] = await conn.query<RowDataPacket[]>(
      `SELECT TABLE_NAME AS name, AUTO_INCREMENT AS next FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME <> 'schema_migrations'`,
    );
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const t of tables) {
        const name = String(t.name);
        if (t.next === null) {
          await conn.query(`DELETE FROM \`${name}\``);
        } else if (Number(t.next) > 1) {
          await conn.query(`DELETE FROM \`${name}\``);
          await conn.query(`ALTER TABLE \`${name}\` AUTO_INCREMENT = 1`);
        }
      }
    } finally {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    }
  } finally {
    conn.release();
  }
}

/** Raw row access for assertions (e.g. a soft-deleted row is still in the table). */
export async function rawRows(sql: string, values: unknown[] = []): Promise<RowDataPacket[]> {
  const [rows] = await testPool().query<RowDataPacket[]>(sql, values);
  return rows;
}
