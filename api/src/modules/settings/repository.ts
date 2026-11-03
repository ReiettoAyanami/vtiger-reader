import type { RowDataPacket } from 'mysql2/promise';
import type { Queryable } from '../../db/pool.js';
import type { Owner } from '../../shared/owner.js';

export interface SettingsRow {
  language: string;
  timezone: string;
}

/** The owner's settings row (one per user), or null when the user has none yet. */
export async function findSettings(db: Queryable, owner: Owner): Promise<SettingsRow | null> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT language, timezone FROM user_settings WHERE user_id = ?', [owner.userId]);
  const row = rows[0];
  if (!row) return null;
  return { language: String(row.language), timezone: String(row.timezone) };
}

/** Writes the owner's whole settings row: inserted the first time, replaced after. */
export async function saveSettings(db: Queryable, owner: Owner, row: SettingsRow): Promise<void> {
  await db.query(
    `INSERT INTO user_settings (user_id, language, timezone) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE language = VALUES(language), timezone = VALUES(timezone)`,
    [owner.userId, row.language, row.timezone],
  );
}
