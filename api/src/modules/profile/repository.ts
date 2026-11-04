import type { Queryable, Row } from '../../db/database.js';
import type { Owner } from '../../shared/owner.js';
import { insertDefaultLists } from '../lists/repository.js';

export interface StartingSettings {
  language: string;
  timezone: string;
}

export async function profileExists(db: Queryable, owner: Owner): Promise<boolean> {
  const [found] = await db.query<Row[]>('SELECT 1 FROM users WHERE id = ?', [owner.userId]);
  return found.length > 0;
}

/** The profile's row and its starting state: its settings row and the default lists of tickets. */
export async function insertProfile(db: Queryable, owner: Owner, settings: StartingSettings): Promise<void> {
  await db.query('INSERT INTO users (id) VALUES (?)', [owner.userId]);
  await db.query('INSERT INTO user_settings (user_id, language, timezone) VALUES (?, ?, ?)', [
    owner.userId,
    settings.language,
    settings.timezone,
  ]);
  await insertDefaultLists(db, owner);
}
