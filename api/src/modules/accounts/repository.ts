import type { RowDataPacket } from 'mysql2/promise';
import type { Queryable } from '../../db/pool.js';
import type { Owner } from '../../shared/owner.js';
import { insertDefaultLists } from '../lists/repository.js';

/** Is there at least one administrator? (None: the first one is created at startup.) */
export async function hasAdministrator(db: Queryable): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
  return rows.length > 0;
}

export interface StartingSettings {
  language: string;
  timezone: string;
}

/** A new user's starting state: their settings row, and the default lists of tickets. */
export async function insertStartingState(db: Queryable, owner: Owner, settings: StartingSettings): Promise<void> {
  await db.query('INSERT INTO user_settings (user_id, language, timezone) VALUES (?, ?, ?)', [
    owner.userId,
    settings.language,
    settings.timezone,
  ]);
  await insertDefaultLists(db, owner);
}

/**
 * Tables holding one user's own rows, deleted with the user. Every table a later step adds with a
 * user_id (push_subscription) joins this list:
 * the lifecycle test checks that no user_id row survives a deletion.
 */
// ai_task_model before ai_provider: its rows point at a provider.
const USER_TABLES = ['notification_state', 'push_subscription', 'user_settings', 'crm_link', 'image_mark', 'ticket_list', 'ai_task_model', 'ai_usage', 'ai_provider', 'password_history', 'sign_in_failures', 'accounts'] as const;

/**
 * Deletes a user and everything of theirs: preferences and sign-in mechanics only, since nothing
 * of the CRM is ever stored here. Run inside a transaction. The sessions opened by the user as
 * somebody else (impersonations) go with its own. False when there is no such user.
 */
export async function deleteUser(db: Queryable, userId: number): Promise<boolean> {
  const [found] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
  if (found.length === 0) return false;
  for (const table of USER_TABLES) {
    await db.query(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
  }
  await db.query('DELETE FROM sessions WHERE user_id = ? OR impersonated_by = ?', [userId, userId]);
  await db.query('DELETE FROM users WHERE id = ?', [userId]);
  return true;
}

/** Takes back a user created a moment ago whose starting state could not be written. */
export async function deleteFreshUser(db: Queryable, userId: number): Promise<void> {
  for (const table of ['user_settings', 'sign_in_failures', 'sessions', 'accounts']) {
    await db.query(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
  }
  await db.query('DELETE FROM users WHERE id = ?', [userId]);
}
