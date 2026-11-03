import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Queryable } from '../../db/pool.js';

/** The hashes of the passwords a user had, oldest first (a new password must be none of them). */
export async function passwordHistory(db: Queryable, userId: number): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY id', [userId]);
  return rows.map((row) => String(row.password_hash));
}

export async function addPasswordToHistory(db: Queryable, userId: number, passwordHash: string): Promise<void> {
  await db.query('INSERT INTO password_history (user_id, password_hash) VALUES (?, ?)', [userId, passwordHash]);
}

export interface UserRow {
  id: number;
  username: string;
  email: string;
  role: string;
  banned: boolean;
  created_at: Date;
  has_password: boolean;
}

const USER_COLUMNS = `u.id, u.username, u.email, u.role, u.banned, u.created_at,
  EXISTS (SELECT 1 FROM accounts a WHERE a.user_id = u.id AND a.provider_id = 'credential' AND a.password IS NOT NULL) AS has_password`;

function toUserRow(r: RowDataPacket): UserRow {
  return {
    id: Number(r.id),
    username: String(r.username),
    email: String(r.email),
    role: String(r.role),
    banned: Boolean(r.banned),
    created_at: r.created_at as Date,
    has_password: Boolean(r.has_password),
  };
}

/** Every user, by username. */
export async function listUsers(db: Queryable): Promise<UserRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${USER_COLUMNS} FROM users u ORDER BY u.username`);
  return rows.map(toUserRow);
}

export async function findUser(db: Queryable, id: number): Promise<UserRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = ?`, [id]);
  return rows[0] ? toUserRow(rows[0]) : null;
}

export async function findUserIdByUsername(db: Queryable, username: string): Promise<number | null> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE username = ?', [username]);
  return rows[0] ? Number(rows[0].id) : null;
}

/** The user who has this email, or null. */
export async function userIdByEmail(db: Queryable, email: string): Promise<number | null> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT id FROM users WHERE email = ?', [email]);
  return rows[0] ? Number(rows[0].id) : null;
}

export interface UserChanges {
  email?: string;
  role?: string;
  banned?: boolean;
}

/** Changes a user's email, role or block; false when the user does not exist. */
export async function updateUser(db: Queryable, id: number, changes: UserChanges, now: Date): Promise<boolean> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (changes.email !== undefined) {
    sets.push('email = ?');
    values.push(changes.email);
  }
  if (changes.role !== undefined) {
    sets.push('role = ?');
    values.push(changes.role);
  }
  if (changes.banned !== undefined) {
    // Better Auth's own ban columns: a block has no reason and no end.
    sets.push('banned = ?', 'ban_reason = NULL', 'ban_expires = NULL');
    values.push(changes.banned);
  }
  sets.push('updated_at = ?');
  values.push(now);
  const [result] = await db.query<ResultSetHeader>(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...values, id]);
  return result.affectedRows > 0;
}

/** How many administrators can sign in, leaving one user out of the count. */
export async function countActiveAdministratorsBesides(db: Queryable, userId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND banned = FALSE AND id <> ?", [
    userId,
  ]);
  return Number(rows[0]?.n ?? 0);
}

/** The tokens of the sessions an administrator opened as other users (impersonations). */
export async function impersonationTokensBy(db: Queryable, adminId: number): Promise<string[]> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT token FROM sessions WHERE impersonated_by = ?', [adminId]);
  return rows.map((row) => String(row.token));
}

export interface SignInFailures {
  failures: number;
  lastFailureAt: Date;
}

/** A user's wrong passwords in a row and the time of the last one, or null when there were none. */
export async function signInFailures(db: Queryable, userId: number): Promise<SignInFailures | null> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT failures, last_failure_at FROM sign_in_failures WHERE user_id = ?', [userId]);
  const row = rows[0];
  if (!row || Number(row.failures) === 0) return null;
  return { failures: Number(row.failures), lastFailureAt: row.last_failure_at as Date };
}

/** One more wrong password in a row. */
export async function addSignInFailure(db: Queryable, userId: number, at: Date): Promise<void> {
  await db.query(
    `INSERT INTO sign_in_failures (user_id, failures, last_failure_at) VALUES (?, 1, ?) AS new
     ON DUPLICATE KEY UPDATE failures = sign_in_failures.failures + 1, last_failure_at = new.last_failure_at`,
    [userId, at],
  );
}

/** A right password: the count starts again from nothing. */
export async function clearSignInFailures(db: Queryable, userId: number): Promise<void> {
  await db.query('UPDATE sign_in_failures SET failures = 0 WHERE user_id = ?', [userId]);
}
