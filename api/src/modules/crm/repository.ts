import type { RowDataPacket } from 'mysql2/promise';
import type { Queryable } from '../../db/pool.js';
import type { Owner } from '../../shared/owner.js';

export interface CrmLinkRow {
  crmUrl: string;
  crmUsername: string;
  accessKeySealed: string;
  crmUserId: string;
  linkedAt: Date;
  lastLoginAt: Date | null;
}

/** The owner's CRM link, or null when they have none. */
export async function findLink(db: Queryable, owner: Owner): Promise<CrmLinkRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT crm_url, crm_username, access_key_sealed, crm_user_id, linked_at, last_login_at
       FROM crm_link WHERE user_id = ?`,
    [owner.userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    crmUrl: String(row.crm_url),
    crmUsername: String(row.crm_username),
    accessKeySealed: String(row.access_key_sealed),
    crmUserId: String(row.crm_user_id),
    linkedAt: row.linked_at as Date,
    lastLoginAt: (row.last_login_at as Date | null) ?? null,
  };
}

/** Links the owner's CRM account, or replaces the one they had; the login that checked it counts. */
export async function saveLink(
  db: Queryable,
  owner: Owner,
  link: { crmUrl: string; crmUsername: string; accessKeySealed: string; crmUserId: string },
): Promise<void> {
  await db.query(
    `INSERT INTO crm_link (user_id, crm_url, crm_username, access_key_sealed, crm_user_id, last_login_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))
     ON DUPLICATE KEY UPDATE crm_url = VALUES(crm_url), crm_username = VALUES(crm_username), access_key_sealed = VALUES(access_key_sealed),
       crm_user_id = VALUES(crm_user_id), last_login_at = VALUES(last_login_at), linked_at = CURRENT_TIMESTAMP(3)`,
    [owner.userId, link.crmUrl, link.crmUsername, link.accessKeySealed, link.crmUserId],
  );
}

/** A login with the owner's link succeeded. */
export async function touchLogin(db: Queryable, owner: Owner, crmUserId: string): Promise<void> {
  await db.query('UPDATE crm_link SET last_login_at = CURRENT_TIMESTAMP(3), crm_user_id = ? WHERE user_id = ?', [crmUserId, owner.userId]);
}

/** Unlinks: the row goes, with the sealed key. */
export async function deleteLink(db: Queryable, owner: Owner): Promise<void> {
  await db.query('DELETE FROM crm_link WHERE user_id = ?', [owner.userId]);
}
