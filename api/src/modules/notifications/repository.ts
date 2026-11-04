import { createHash } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Queryable } from '../../db/pool.js';
import { ownerOf, type Owner } from '../../shared/owner.js';

/** A user's notification bookkeeping (migration 008): their switch, how far the checks have looked. */
export interface NotificationState {
  enabled: boolean;
  /** The CRM time ('YYYY-MM-DD HH:MM:SS', UTC) of the newest ticket already looked at; null: none yet. */
  watermark: string | null;
  /** The CRM time of the newest ticket the bell showed when last opened; null: never opened. */
  bellSeenAt: string | null;
}

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** A user the checks look for new tickets for: linked to a CRM, not banned, notifications on. */
export interface WatchedUser {
  owner: Owner;
  username: string;
}

const DEFAULT_STATE: NotificationState = { enabled: true, watermark: null, bellSeenAt: null };

/** A DATETIME as mysql2 gives it (a Date, read as UTC by the pool) in the CRM's own format. */
function crmTimeOfColumn(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 19).replace('T', ' ');
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) return value.slice(0, 19);
  return null;
}

export async function findState(db: Queryable, owner: Owner): Promise<NotificationState> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT enabled, watermark, bell_seen_at FROM notification_state WHERE user_id = ?', [owner.userId]);
  const row = rows[0];
  if (!row) return { ...DEFAULT_STATE };
  return { enabled: Boolean(row.enabled), watermark: crmTimeOfColumn(row.watermark), bellSeenAt: crmTimeOfColumn(row.bell_seen_at) };
}

/** Writes some of the owner's state; the row is made at the first write. */
export async function saveState(db: Queryable, owner: Owner, patch: Partial<NotificationState>): Promise<void> {
  const state = { ...(await findState(db, owner)), ...patch };
  await db.query(
    `INSERT INTO notification_state (user_id, enabled, watermark, bell_seen_at) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), watermark = VALUES(watermark), bell_seen_at = VALUES(bell_seen_at)`,
    [owner.userId, state.enabled, state.watermark, state.bellSeenAt],
  );
}

/**
 * Moves the owner's watermark from `from` to `to`, only if nobody moved it meanwhile (two checks of
 * one user never both send: plan 5.1, "nothing is sent twice"). True when this call moved it.
 */
export async function moveWatermark(db: Queryable, owner: Owner, from: string, to: string): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>('UPDATE notification_state SET watermark = ? WHERE user_id = ? AND watermark = ?', [
    to,
    owner.userId,
    from,
  ]);
  return result.affectedRows > 0;
}

/** Every user with a CRM link, not banned, whose notifications are on (or were never turned off). */
export async function listWatchedUsers(db: Queryable): Promise<WatchedUser[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT u.id, u.username
       FROM users u
       JOIN crm_link c ON c.user_id = u.id
       LEFT JOIN notification_state n ON n.user_id = u.id
      WHERE (u.banned IS NULL OR u.banned = FALSE) AND (n.enabled IS NULL OR n.enabled = TRUE)
      ORDER BY u.id`,
  );
  return rows.map((r) => ({ owner: ownerOf(Number(r.id)), username: String(r.username) }));
}

/** The sha256 of an endpoint: its key in the table (an endpoint is too long for a unique index). */
export function endpointHash(endpoint: string): string {
  return createHash('sha256').update(endpoint, 'utf8').digest('hex');
}

export async function listSubscriptions(db: Queryable, owner: Owner): Promise<PushSubscriptionRow[]> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT endpoint, p256dh, auth FROM push_subscription WHERE user_id = ? ORDER BY id', [owner.userId]);
  return rows.map((r) => ({ endpoint: String(r.endpoint), p256dh: String(r.p256dh), auth: String(r.auth) }));
}

export async function countSubscriptions(db: Queryable, owner: Owner): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM push_subscription WHERE user_id = ?', [owner.userId]);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Saves a browser's subscription for the owner. An endpoint is one browser's: when another user
 * had it (they signed out, the owner signed in on the same browser), it moves to the owner, so the
 * browser never shows the other user's tickets.
 */
export async function saveSubscription(db: Queryable, owner: Owner, sub: PushSubscriptionRow): Promise<void> {
  await db.query(
    `INSERT INTO push_subscription (user_id, endpoint, endpoint_hash, p256dh, auth) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), endpoint = VALUES(endpoint), p256dh = VALUES(p256dh), auth = VALUES(auth)`,
    [owner.userId, sub.endpoint, endpointHash(sub.endpoint), sub.p256dh, sub.auth],
  );
}

/** The owner's subscription of this endpoint goes (another user's is not touched). */
export async function deleteSubscription(db: Queryable, owner: Owner, endpoint: string): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>('DELETE FROM push_subscription WHERE user_id = ? AND endpoint_hash = ?', [
    owner.userId,
    endpointHash(endpoint),
  ]);
  return result.affectedRows > 0;
}

/** The instance's VAPID keys, or null before they are made. */
export async function findVapid(db: Queryable): Promise<{ publicKey: string; privateKeySealed: string } | null> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT public_key, private_key_sealed FROM push_vapid WHERE id = 1');
  const row = rows[0];
  return row ? { publicKey: String(row.public_key), privateKeySealed: String(row.private_key_sealed) } : null;
}

/** Saves the instance's VAPID keys, unless another start saved its own first (theirs stay). */
export async function insertVapid(db: Queryable, publicKey: string, privateKeySealed: string): Promise<void> {
  await db.query('INSERT IGNORE INTO push_vapid (id, public_key, private_key_sealed) VALUES (1, ?, ?)', [publicKey, privateKeySealed]);
}

/** The instance's VAPID keys go (they no longer open: ENCRYPTION_KEY changed), with every subscription made with them. */
export async function resetVapid(db: Queryable): Promise<void> {
  await db.query('DELETE FROM push_subscription');
  await db.query('DELETE FROM push_vapid');
}
