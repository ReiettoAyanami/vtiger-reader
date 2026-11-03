import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Queryable } from '../../db/pool.js';
import type { Owner } from '../../shared/owner.js';
import type { ProviderKind } from './adapter.js';

export interface ProviderRow {
  id: number;
  kind: ProviderKind;
  label: string;
  baseUrl: string | null;
  keySealed: string | null;
  keyHint: string | null;
}

function toProvider(r: RowDataPacket): ProviderRow {
  return {
    id: Number(r.id),
    kind: r.kind as ProviderKind,
    label: String(r.label),
    baseUrl: r.base_url === null ? null : String(r.base_url),
    keySealed: r.key_sealed === null ? null : String(r.key_sealed),
    keyHint: r.key_hint === null ? null : String(r.key_hint),
  };
}

export async function listProviders(db: Queryable, owner: Owner): Promise<ProviderRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT id, kind, label, base_url, key_sealed, key_hint FROM ai_provider WHERE user_id = ? ORDER BY id',
    [owner.userId],
  );
  return rows.map(toProvider);
}

export async function findProvider(db: Queryable, owner: Owner, id: number): Promise<ProviderRow | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT id, kind, label, base_url, key_sealed, key_hint FROM ai_provider WHERE user_id = ? AND id = ?',
    [owner.userId, id],
  );
  return rows[0] ? toProvider(rows[0]) : null;
}

export async function insertProvider(db: Queryable, owner: Owner, p: Omit<ProviderRow, 'id'>): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    'INSERT INTO ai_provider (user_id, kind, label, base_url, key_sealed, key_hint) VALUES (?, ?, ?, ?, ?, ?)',
    [owner.userId, p.kind, p.label, p.baseUrl, p.keySealed, p.keyHint],
  );
  return result.insertId;
}

/** Label and address; the key only when a new one is given (undefined keeps it). */
export async function updateProvider(
  db: Queryable,
  owner: Owner,
  id: number,
  p: { label: string; baseUrl: string | null; key?: { sealed: string | null; hint: string | null } },
): Promise<void> {
  if (p.key) {
    await db.query('UPDATE ai_provider SET label = ?, base_url = ?, key_sealed = ?, key_hint = ? WHERE user_id = ? AND id = ?', [
      p.label,
      p.baseUrl,
      p.key.sealed,
      p.key.hint,
      owner.userId,
      id,
    ]);
  } else {
    await db.query('UPDATE ai_provider SET label = ?, base_url = ? WHERE user_id = ? AND id = ?', [p.label, p.baseUrl, owner.userId, id]);
  }
}

/** Deletes a provider; its task rows go with it (ON DELETE CASCADE). */
export async function deleteProvider(db: Queryable, owner: Owner, id: number): Promise<boolean> {
  const [result] = await db.query<ResultSetHeader>('DELETE FROM ai_provider WHERE user_id = ? AND id = ?', [owner.userId, id]);
  return result.affectedRows > 0;
}

export interface TaskModelRow {
  task: string;
  providerId: number;
  model: string;
}

export async function listTaskModels(db: Queryable, owner: Owner): Promise<TaskModelRow[]> {
  const [rows] = await db.query<RowDataPacket[]>('SELECT task, provider_id, model FROM ai_task_model WHERE user_id = ?', [owner.userId]);
  return rows.map((r) => ({ task: String(r.task), providerId: Number(r.provider_id), model: String(r.model) }));
}

export async function setTaskModel(db: Queryable, owner: Owner, task: string, providerId: number, model: string): Promise<void> {
  await db.query(
    `INSERT INTO ai_task_model (user_id, task, provider_id, model) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE provider_id = VALUES(provider_id), model = VALUES(model)`,
    [owner.userId, task, providerId, model],
  );
}

/** Back to the default model for the task (a preference taken back). */
export async function clearTaskModel(db: Queryable, owner: Owner, task: string): Promise<void> {
  await db.query('DELETE FROM ai_task_model WHERE user_id = ? AND task = ?', [owner.userId, task]);
}

export interface UsageRow {
  day: string;
  kind: string;
  model: string;
  task: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

export async function addUsage(db: Queryable, owner: Owner, u: Omit<UsageRow, 'calls'>): Promise<void> {
  await db.query(
    `INSERT INTO ai_usage (user_id, day, kind, model, task, calls, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON DUPLICATE KEY UPDATE calls = calls + 1, tokens_in = tokens_in + VALUES(tokens_in), tokens_out = tokens_out + VALUES(tokens_out)`,
    [owner.userId, u.day, u.kind, u.model, u.task, u.tokensIn, u.tokensOut],
  );
}

export async function usageSince(db: Queryable, owner: Owner, day: string): Promise<UsageRow[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT DATE_FORMAT(day, '%Y-%m-%d') AS day, kind, model, task, calls, tokens_in, tokens_out
       FROM ai_usage WHERE user_id = ? AND day >= ? ORDER BY day DESC, model, task`,
    [owner.userId, day],
  );
  return rows.map((r) => ({
    day: String(r.day),
    kind: String(r.kind),
    model: String(r.model),
    task: String(r.task),
    calls: Number(r.calls),
    tokensIn: Number(r.tokens_in),
    tokensOut: Number(r.tokens_out),
  }));
}
