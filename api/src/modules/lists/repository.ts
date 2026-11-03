import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Queryable } from '../../db/pool.js';
import type { Owner } from '../../shared/owner.js';
import { DEFAULT_LISTS, parseFilter, type ListFilter, type TicketList } from './filter.js';

function toList(row: RowDataPacket): TicketList {
  return { id: Number(row.id), name: String(row.name), filter: parseFilter(row.filter) };
}

/** The owner's lists, in their order. */
export async function listLists(db: Queryable, owner: Owner): Promise<TicketList[]> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT id, name, filter FROM ticket_list WHERE user_id = ? ORDER BY position, id', [
    owner.userId,
  ]);
  return rows.map(toList);
}

/** One of the owner's lists; null when it is not theirs, or does not exist. */
export async function findList(db: Queryable, owner: Owner, id: number): Promise<TicketList | null> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT id, name, filter FROM ticket_list WHERE user_id = ? AND id = ?', [owner.userId, id]);
  return rows[0] ? toList(rows[0]) : null;
}

/** A new list, last. */
export async function insertList(db: Queryable, owner: Owner, name: string, filter: ListFilter): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO ticket_list (user_id, position, name, filter)
     SELECT ?, COALESCE(MAX(position) + 1, 0), ?, CAST(? AS JSON) FROM ticket_list WHERE user_id = ?`,
    [owner.userId, name, JSON.stringify(filter), owner.userId],
  );
  return result.insertId;
}

/** A new user's lists (the account lifecycle, at creation). */
export async function insertDefaultLists(db: Queryable, owner: Owner): Promise<void> {
  const values = DEFAULT_LISTS.map((l, i) => [owner.userId, i, l.name, JSON.stringify(l.filter)]);
  await db.query('INSERT INTO ticket_list (user_id, position, name, filter) VALUES ?', [values]);
}

export async function updateList(db: Queryable, owner: Owner, id: number, name: string, filter: ListFilter): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>(
    'UPDATE ticket_list SET name = ?, filter = CAST(? AS JSON) WHERE user_id = ? AND id = ?',
    [name, JSON.stringify(filter), owner.userId, id],
  );
  return result.affectedRows > 0;
}

/** The owner's lists in this order (every one of them, checked by the service). */
export async function reorderLists(db: Queryable, owner: Owner, ids: readonly number[]): Promise<void> {
  for (const [position, id] of ids.entries()) {
    await db.query('UPDATE ticket_list SET position = ? WHERE user_id = ? AND id = ?', [position, owner.userId, id]);
  }
}

/** Deletes a list (a preference: nothing to keep). */
export async function deleteList(db: Queryable, owner: Owner, id: number): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>('DELETE FROM ticket_list WHERE user_id = ? AND id = ?', [owner.userId, id]);
  return result.affectedRows > 0;
}
