import type { Queryable, Row, RunResult } from '../../db/database.js';
import { ownerOf, type Owner } from '../../shared/owner.js';

/** A profile's notification bookkeeping: its switch, how far the checks have looked. */
export interface NotificationState {
  enabled: boolean;
  /** The CRM time ('YYYY-MM-DD HH:MM:SS', UTC) of the newest ticket already looked at; null: none yet. */
  watermark: string | null;
  /** The CRM time of the newest ticket the bell showed when last opened; null: never opened. */
  bellSeenAt: string | null;
}

/** A profile the checks look for new tickets for: linked to a CRM, notifications on. */
export interface WatchedUser {
  owner: Owner;
}

const DEFAULT_STATE: NotificationState = { enabled: true, watermark: null, bellSeenAt: null };

/** A stored CRM time ('YYYY-MM-DD HH:MM:SS', UTC), or a Date, in the CRM's own format. */
function crmTimeOfColumn(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) return value.slice(0, 19);
  return null;
}

export async function findState(db: Queryable, owner: Owner): Promise<NotificationState> {
  const [rows] = await db.query<Row[]>('SELECT enabled, watermark, bell_seen_at FROM notification_state WHERE user_id = ?', [owner.userId]);
  const row = rows[0];
  if (!row) return { ...DEFAULT_STATE };
  return { enabled: Boolean(row.enabled), watermark: crmTimeOfColumn(row.watermark), bellSeenAt: crmTimeOfColumn(row.bell_seen_at) };
}

/** Writes some of the owner's state; the row is made at the first write. */
export async function saveState(db: Queryable, owner: Owner, patch: Partial<NotificationState>): Promise<void> {
  const state = { ...(await findState(db, owner)), ...patch };
  await db.query(
    `INSERT INTO notification_state (user_id, enabled, watermark, bell_seen_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET enabled = excluded.enabled, watermark = excluded.watermark, bell_seen_at = excluded.bell_seen_at`,
    [owner.userId, state.enabled, state.watermark, state.bellSeenAt],
  );
}

/**
 * Moves the owner's watermark from `from` to `to`, only if nobody moved it meanwhile (two checks of
 * one user never both send: plan 5.1, "nothing is sent twice"). True when this call moved it.
 */
export async function moveWatermark(db: Queryable, owner: Owner, from: string, to: string): Promise<boolean> {
  const [result] = await db.query<RunResult>('UPDATE notification_state SET watermark = ? WHERE user_id = ? AND watermark = ?', [
    to,
    owner.userId,
    from,
  ]);
  return result.affectedRows > 0;
}

/** Every profile with a CRM link whose notifications are on (or were never turned off). */
export async function listWatchedUsers(db: Queryable): Promise<WatchedUser[]> {
  const [rows] = await db.query<Row[]>(
    `SELECT u.id
       FROM users u
       JOIN crm_link c ON c.user_id = u.id
       LEFT JOIN notification_state n ON n.user_id = u.id
      WHERE n.enabled IS NULL OR n.enabled = TRUE
      ORDER BY u.id`,
  );
  return rows.map((r) => ({ owner: ownerOf(Number(r.id)) }));
}
