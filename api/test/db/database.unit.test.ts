import { describe, expect, it } from 'vitest';
import { expandParams, openDatabase, type Row, type RunResult } from '../../src/db/database.js';

describe('expandParams', () => {
  it('plain values stay one ? each; booleans become 0/1, dates ISO text, undefined NULL', () => {
    const at = new Date('2026-11-04T10:00:00Z');
    expect(expandParams('SELECT ? , ?, ?, ?', ['a', true, at, undefined])).toEqual({
      sql: 'SELECT ? , ?, ?, ?',
      values: ['a', 1, '2026-11-04T10:00:00.000Z', null],
    });
  });

  it('an array is written out for IN; an empty one matches nothing', () => {
    expect(expandParams('WHERE id IN (?) AND user_id = ?', [[1, 2, 3], 7])).toEqual({
      sql: 'WHERE id IN (?, ?, ?) AND user_id = ?',
      values: [1, 2, 3, 7],
    });
    expect(expandParams('WHERE id IN (?)', [[]])).toEqual({ sql: 'WHERE id IN (NULL)', values: [] });
  });

  it('an array of rows is written out for VALUES', () => {
    expect(expandParams('INSERT INTO t (a, b) VALUES ?', [[[1, 'x'], [2, 'y']]])).toEqual({
      sql: 'INSERT INTO t (a, b) VALUES (?, ?), (?, ?)',
      values: [1, 'x', 2, 'y'],
    });
  });

  it('a ? inside a quoted string is not a parameter; the counts must match', () => {
    expect(expandParams("SELECT '?' AS q, ?", [5])).toEqual({ sql: "SELECT '?' AS q, ?", values: [5] });
    expect(() => expandParams('SELECT ?, ?', [1])).toThrow(/more parameters/);
    expect(() => expandParams('SELECT ?', [1, 2])).toThrow(/1 parameters, 2 values/);
    expect(() => expandParams('SELECT ?', [{}])).toThrow(/cannot be bound/);
  });
});

describe('Database', () => {
  it('rows for a SELECT, changes and the new id for the rest', async () => {
    const db = openDatabase(':memory:');
    try {
      db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)');
      const [inserted] = await db.query<RunResult>('INSERT INTO t (name) VALUES ?', [[['a'], ['b']]]);
      expect(inserted).toEqual({ affectedRows: 2, insertId: 2 });
      const [rows] = await db.query<Row[]>('SELECT id, name FROM t WHERE id IN (?) ORDER BY id', [[1, 2]]);
      expect(rows).toEqual([
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
      ]);
      const [updated] = await db.query<RunResult>('UPDATE t SET name = ? WHERE id = ?', ['c', 9]);
      expect(updated.affectedRows).toBe(0);
    } finally {
      db.close();
    }
  });

  it('a closed database fails the liveness check', () => {
    const db = openDatabase(':memory:');
    db.ping();
    db.close();
    expect(() => db.ping()).toThrow();
  });
});
