import type { Queryable, Row } from '../../db/database.js';
import type { Owner } from '../../shared/owner.js';
import type { ImagePrint, Mark, SavedMark } from './files.js';

/** The owner's image marks (a few dozen at most: logos of the customers who write). */
export async function listMarks(db: Queryable, owner: Owner): Promise<SavedMark[]> {
  const [rows] = await db.query<Row[]>('SELECT exact_hash, dhash, ratio, mark FROM image_mark WHERE user_id = ?', [owner.userId]);
  return rows.map((r) => ({ exact: String(r.exact_hash), dhash: String(r.dhash), ratio: Number(r.ratio), mark: r.mark as Mark }));
}

/** Marks an image (the same file again: the new mark replaces the old). */
export async function saveMark(db: Queryable, owner: Owner, print: ImagePrint, mark: Mark): Promise<void> {
  await db.query(
    `INSERT INTO image_mark (user_id, exact_hash, dhash, ratio, mark) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, exact_hash) DO UPDATE SET dhash = excluded.dhash, ratio = excluded.ratio, mark = excluded.mark`,
    [owner.userId, print.exact, print.dhash, Number(print.ratio.toFixed(4)), mark],
  );
}

/**
 * Takes a mark back: the file's own, and the marks it matched by likeness (otherwise a near copy
 * would keep the image where the user just moved it from).
 */
export async function deleteMarks(db: Queryable, owner: Owner, exactHashes: readonly string[]): Promise<void> {
  if (exactHashes.length === 0) return;
  await db.query('DELETE FROM image_mark WHERE user_id = ? AND exact_hash IN (?)', [owner.userId, exactHashes]);
}
