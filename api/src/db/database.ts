import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite';

/** A row as a SELECT gives it: column name → value (number, string, null, Uint8Array). */
export type Row = Record<string, unknown>;

/** What a statement that changes rows answers. */
export interface RunResult {
  /** How many rows it inserted, changed or deleted. */
  affectedRows: number;
  /** The id of the row it inserted (the last one). */
  insertId: number;
}

/**
 * Anything that runs SQL (plan 7.3): the app's SQLite database. The shape of the old mysql2 pool, so
 * that the repositories keep theirs: `const [rows] = await db.query<Row[]>(sql, params)`, or
 * `const [result] = await db.query<RunResult>(sql, params)` for a statement that changes rows.
 */
export interface Queryable {
  query<T extends Row[] | RunResult = Row[]>(sql: string, params?: readonly unknown[]): Promise<[T]>;
}

/** Statements that answer rows; any other one answers a RunResult. */
const RETURNS_ROWS = /^\s*(SELECT|WITH|PRAGMA|VALUES)\b|\bRETURNING\b/i;

/** At most this many prepared statements are kept (the expanded IN lists make a few more). */
const STATEMENT_CACHE_SIZE = 200;

/** A value as SQLite can bind it: booleans as 0/1, dates as ISO text, undefined as NULL. */
function bindable(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value;
  if (value instanceof Uint8Array) return value;
  throw new TypeError(`A value of type ${typeof value} cannot be bound to an SQL parameter`);
}

/**
 * The SQL with each `?` whose value is an array written out, as mysql2 did: `IN (?)` with [1, 2]
 * becomes `IN (?, ?)`, `VALUES ?` with [[1, 'a'], [2, 'b']] becomes `VALUES (?, ?), (?, ?)`; an
 * empty array is NULL (`IN (NULL)` matches nothing). A `?` inside a quoted string is left alone.
 */
export function expandParams(sql: string, params: readonly unknown[]): { sql: string; values: SQLInputValue[] } {
  const values: SQLInputValue[] = [];
  let out = '';
  let next = 0;
  let quote: string | null = null;
  for (const char of sql) {
    if (quote) {
      if (char === quote) quote = null;
      out += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      out += char;
      continue;
    }
    if (char !== '?') {
      out += char;
      continue;
    }
    if (next >= params.length) throw new Error(`The SQL has more parameters than the ${params.length} values given`);
    const value = params[next++];
    if (!Array.isArray(value)) {
      values.push(bindable(value));
      out += '?';
    } else if (value.length === 0) {
      out += 'NULL';
    } else if (value.every(Array.isArray)) {
      out += value.map((tuple: unknown[]) => `(${tuple.map(() => '?').join(', ')})`).join(', ');
      for (const tuple of value as unknown[][]) for (const item of tuple) values.push(bindable(item));
    } else {
      out += value.map(() => '?').join(', ');
      for (const item of value) values.push(bindable(item));
    }
  }
  if (next !== params.length) throw new Error(`The SQL has ${next} parameters, ${params.length} values given`);
  return { sql: out, values };
}

/**
 * The app's database: one SQLite file in this process (no server, no pool, no connections). SQLite
 * answers at once, so a query never waits on anything; the promises only keep the repositories'
 * shape.
 */
export class Database implements Queryable {
  private readonly statements = new Map<string, StatementSync>();

  constructor(private readonly sqlite: DatabaseSync) {}

  async query<T extends Row[] | RunResult = Row[]>(sql: string, params: readonly unknown[] = []): Promise<[T]> {
    const expanded = expandParams(sql, params);
    const statement = this.prepare(expanded.sql);
    if (RETURNS_ROWS.test(expanded.sql)) {
      return [statement.all(...expanded.values) as unknown as T];
    }
    const result = statement.run(...expanded.values);
    return [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) } as T];
  }

  /** A script of statements (a migration), with no parameters. */
  exec(sql: string): void {
    this.sqlite.exec(sql);
  }

  /** Liveness: throws when the database is closed or broken. */
  ping(): void {
    this.sqlite.prepare('SELECT 1').get();
  }

  get isOpen(): boolean {
    return this.sqlite.isOpen;
  }

  close(): void {
    this.statements.clear();
    if (this.sqlite.isOpen) this.sqlite.close();
  }

  private prepare(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.sqlite.prepare(sql);
      if (this.statements.size >= STATEMENT_CACHE_SIZE) this.statements.clear();
      this.statements.set(sql, statement);
    }
    return statement;
  }
}

/**
 * Opens (or makes) the database file, its folder too; ':memory:' for one that lives only in this
 * process (the tests). Foreign keys are enforced; a file database writes ahead (WAL), so a read
 * never waits for a write.
 */
export function openDatabase(file: string): Database {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  return new Database(sqlite);
}
