/**
 * VTQL, the CRM's query language: `SELECT fields FROM Module [WHERE ...] [ORDER BY ...] [LIMIT m, n];`
 * One module per query, no joins, at most 100 rows per answer (OpenCRM manual).
 *
 * Queries are built here from parts, never by gluing user input into a string elsewhere: values go
 * through `literal`, record ids through `idLiteral`, search words through `containsLiteral`.
 */

/** The most rows the CRM returns for one query. */
export const MAX_ROWS = 100;

/** A record id of the webservice: `<module number>x<record number>`, e.g. `17x1234`. */
export const RECORD_ID = /^\d+x\d+$/;

export function isRecordId(value: string): boolean {
  return RECORD_ID.test(value);
}

/** A module or field name as the CRM names them (letters, digits, _). */
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function name(value: string): string {
  if (!NAME.test(value)) throw new Error(`Not a CRM module or field name: "${value}"`);
  return value;
}

/**
 * A quoted string value. Backslash and quote are escaped with a backslash (as MySQL reads them,
 * under the CRM's parser); control characters and `;` (the end of a query) are dropped.
 * To be checked against our CRM in the spike (plan 2.1): a value with an apostrophe.
 */
export function literal(value: string): string {
  const clean = value.replace(/[\u0000-\u001f\u007f;]/g, ' ');
  return `'${clean.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** A record id, checked: `'17x1234'`. */
export function idLiteral(value: string): string {
  if (!isRecordId(value)) throw new Error(`Not a CRM record id: "${value}"`);
  return `'${value}'`;
}

/**
 * `'%words%'` for a LIKE on what the user typed. The CRM's LIKE has no escape for % and _, so they
 * become spaces, with the quotes and backslashes (cerini-ia does the same); at most 60 characters.
 */
export function containsLiteral(text: string): string {
  const words = text
    .replace(/[\u0000-\u001f\u007f;'"%_\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `'%${words}%'`;
}

export interface VtqlSelect {
  module: string;
  /** Field names; `id` is always there. Unknown ones are dropped by the client (from `describe`). */
  fields: readonly string[];
  /** A condition built with this file's helpers. */
  where?: string;
  /** e.g. `createdtime DESC`. */
  orderBy?: { field: string; direction: 'ASC' | 'DESC' };
  /** Rows to skip and to return (at most MAX_ROWS). */
  offset?: number;
  limit?: number;
}

/** The VTQL text of a select, the fields as given (the client filters them first). */
export function selectText(select: VtqlSelect): string {
  const fields = [...new Set(['id', ...select.fields.map(name)])];
  let text = `SELECT ${fields.join(', ')} FROM ${name(select.module)}`;
  if (select.where) text += ` WHERE ${select.where}`;
  if (select.orderBy) text += ` ORDER BY ${name(select.orderBy.field)} ${select.orderBy.direction === 'ASC' ? 'ASC' : 'DESC'}`;
  const limit = Math.min(Math.max(Math.trunc(select.limit ?? MAX_ROWS), 1), MAX_ROWS);
  const offset = Math.max(Math.trunc(select.offset ?? 0), 0);
  text += offset > 0 ? ` LIMIT ${offset}, ${limit}` : ` LIMIT ${limit}`;
  return `${text};`;
}

/** The VTQL text that counts a module's rows matching a condition. */
export function countText(module: string, where?: string): string {
  return `SELECT count(*) FROM ${name(module)}${where ? ` WHERE ${where}` : ''};`;
}
