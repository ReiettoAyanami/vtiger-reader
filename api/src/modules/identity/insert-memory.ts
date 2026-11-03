import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool } from '../../db/pool.js';

/**
 * Better Auth, on MySQL, reads a row it has just inserted back with `SELECT LAST_INSERT_ID() as id`
 * run on whatever connection the pool hands out next, not on the insert's own. Under load another
 * connection answers with its own last id, and a sign-in can come back with another user's session
 * (design-accounts.md, "Identity as built (1.1)": 41 sign-ins of 200 on a 2-connection pool).
 *
 * The fix keeps MySQL's own ids. Better Auth gets the API's pool, but every auth operation runs
 * inside `runAuth()`, which remembers the id of the last insert it made; when that operation asks
 * for LAST_INSERT_ID(), the answer comes from its memory, whatever connection it is on. Operations
 * running at the same time have their own memory. The rest of the API, which reads `insertId` from
 * its own results, never goes through here.
 */

interface Memory {
  lastInsertId: number | null;
}

const memory = new AsyncLocalStorage<Memory>();

/** Runs one auth operation: its inserts are remembered for its own LAST_INSERT_ID reads. */
export function runAuth<T>(operation: () => Promise<T>): Promise<T> {
  return memory.run({ lastInsertId: null }, operation);
}

const LAST_INSERT_ID = /^\s*select\s+last_insert_id\(\)\s+as\s+id\s*;?\s*$/i;

type QueryCallback = (err: unknown, result?: unknown, fields?: unknown) => void;

/** The callback API of a mysql2 connection, as Kysely (Better Auth's query builder) uses it. */
interface CoreConnection {
  query(sql: unknown, values?: unknown, callback?: QueryCallback): unknown;
}

interface CorePool {
  getConnection(callback: (err: unknown, connection?: CoreConnection) => void): void;
}

/** What Better Auth takes as its MySQL database: it builds Kysely's MySQL dialect on `pool`. */
export interface AuthDatabase {
  getConnection(): never;
  pool: {
    getConnection(callback: (err: unknown, connection?: CoreConnection) => void): void;
    end(callback?: (err: unknown) => void): void;
  };
}

function query(connection: CoreConnection, sql: unknown, values: unknown, callback: unknown): unknown {
  const current = memory.getStore();
  if (!current || typeof sql !== 'string' || typeof callback !== 'function') {
    return connection.query(sql, values, callback as QueryCallback | undefined);
  }
  const done = callback as QueryCallback;
  if (LAST_INSERT_ID.test(sql) && current.lastInsertId !== null) {
    const id = current.lastInsertId;
    queueMicrotask(() => done(null, [{ id }], []));
    return undefined;
  }
  return connection.query(sql, values, (err, result, fields) => {
    const insertId = (result as { insertId?: unknown } | undefined)?.insertId;
    if (!err && typeof insertId === 'number' && insertId > 0) current.lastInsertId = insertId;
    done(err, result, fields);
  });
}

/**
 * The API's pool as Better Auth's database: the same connections, each answering LAST_INSERT_ID()
 * from the memory of the auth operation using it. Ending it is a no-op: the API closes its pool.
 */
export function authDatabase(pool: Pool): AuthDatabase {
  const core = (pool as unknown as { pool: CorePool }).pool;
  const wrapped = new WeakMap<CoreConnection, CoreConnection>();
  const wrap = (connection: CoreConnection): CoreConnection => {
    let proxy = wrapped.get(connection);
    if (!proxy) {
      proxy = new Proxy(connection, {
        get(target, property) {
          if (property === 'query') {
            return (sql: unknown, values?: unknown, callback?: unknown) => query(target, sql, values, callback);
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      wrapped.set(connection, proxy);
    }
    return proxy;
  };
  return {
    // Only its presence matters: it tells Better Auth this is a MySQL pool.
    getConnection(): never {
      throw new Error('authDatabase: Better Auth uses .pool');
    },
    pool: {
      getConnection(callback) {
        core.getConnection((err, connection) => {
          if (err || !connection) callback(err ?? new Error('no connection'));
          else callback(null, wrap(connection));
        });
      },
      end(callback) {
        callback?.(null);
      },
    },
  };
}
