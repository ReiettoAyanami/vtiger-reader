import mysql from 'mysql2/promise';
import type { Connection, Pool, PoolConnection } from 'mysql2/promise';
import type { DbConfig } from '../config.js';

/** Anything that can run a query: the pool or a connection inside a transaction. */
export type Queryable = Connection;
export type { Pool, PoolConnection };

interface CoreConnection {
  query(sql: string, cb: (err: unknown) => void): unknown;
}

/**
 * mysql2 pool.
 * - `timezone: 'Z'`: DATETIME values are read and written as UTC.
 * - every new connection runs `SET time_zone = '+00:00'`, so CURRENT_TIMESTAMP / NOW() are UTC.
 * - DECIMAL columns come back as strings (decimalNumbers stays off): money is never a float.
 */
export function createPool(cfg: DbConfig, options: { connectionLimit?: number } = {}): Pool {
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    timezone: 'Z',
    charset: 'utf8mb4',
    decimalNumbers: false,
    supportBigNumbers: true,
    waitForConnections: true,
    connectionLimit: options.connectionLimit ?? 10,
    connectTimeout: 5_000,
  });
  // The promise pool re-emits the core pool's 'connection' event with the callback-style
  // connection object; the query is queued before anything the caller sends on it.
  pool.on('connection', (conn) => {
    const core = conn as unknown as CoreConnection;
    core.query("SET time_zone = '+00:00'", () => undefined);
  });
  return pool;
}

/**
 * Runs `fn` in one transaction on a dedicated connection.
 * READ COMMITTED: after the batch row is locked (SELECT ... FOR UPDATE), every plain read
 * sees what other writers committed before the lock was granted, so remaining is exact.
 */
export async function withTransaction<T>(pool: Pool, fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    try {
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => undefined);
      throw err;
    }
  } finally {
    conn.release();
  }
}

/** Liveness of the database: throws when it does not answer. */
export async function pingDatabase(pool: Pool): Promise<void> {
  await pool.query('SELECT 1');
}

/** True for a duplicate-key error (ER_DUP_ENTRY), e.g. a client_ref sent twice concurrently. */
export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ER_DUP_ENTRY';
}
