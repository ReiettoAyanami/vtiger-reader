import { badRequest } from './errors.js';

/** Optional free text: trimmed, '' and null become null, undefined stays undefined (not sent). */
export function optionalText(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

/** Required free text: trimmed, must not be empty. */
export function requiredText(raw: string, field: string): string {
  const value = raw.trim();
  if (value === '') throw badRequest(`${field} must not be empty`, field);
  return value;
}

/** clientRef (UUID, already pattern-checked by the schema), normalised to lower case. */
export function clientRef(raw: string | undefined): string | null {
  return raw === undefined ? null : raw.toLowerCase();
}
