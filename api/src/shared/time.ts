import { DateTime, IANAZone } from 'luxon';
import { badRequest } from './errors.js';

/**
 * Instants are stored as UTC DATETIME ('YYYY-MM-DD HH:MM:SS', second precision) and exposed
 * as ISO 8601 UTC strings ('2026-09-29T21:40:00Z'). Local time exists only at the edges:
 * the logical day, computed here in TypeScript (never with MySQL CONVERT_TZ).
 */

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

const OFFSET_SUFFIX = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/;

/** Parses an ISO 8601 date-time that carries an offset (Z or ±HH:MM). 400 otherwise. */
export function parseInstant(raw: string, field = 'occurredAt'): Date {
  const text = raw.trim().replace(/^(\d{4}-\d{2}-\d{2})[ tT]/, '$1T');
  if (!OFFSET_SUFFIX.test(text)) {
    throw badRequest(`${field} must be an ISO 8601 date-time with an offset, e.g. 2026-09-29T21:40:00Z`, field);
  }
  const dt = DateTime.fromISO(text, { setZone: true });
  if (!dt.isValid) {
    throw badRequest(`${field} is not a valid date-time: ${dt.invalidExplanation ?? raw}`, field);
  }
  const date = dt.toJSDate();
  const year = date.getUTCFullYear();
  if (year < 1000 || year > 9999) throw badRequest(`${field} is out of range`, field);
  return date;
}

/** Truncates to whole seconds (DATETIME has no fractional part here). */
export function truncateToSecond(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}

/** Date -> 'YYYY-MM-DD HH:MM:SS' in UTC, for DATETIME columns. */
export function toDbDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/** DATETIME read by mysql2 (timezone 'Z') -> '2026-09-29T21:40:00Z'. */
export function toIso(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

export function toIsoOrNull(date: Date | null | undefined): string | null {
  return date ? toIso(date) : null;
}

// ---------------------------------------------------------------------------------------------
// Logical day
// ---------------------------------------------------------------------------------------------

export interface DayConfig {
  /** IANA zone, e.g. Europe/Rome. */
  timezone: string;
  /** 'HH:MM:SS' */
  dayStartsAt: string;
}

export function isValidTimezone(zone: string): boolean {
  if (!IANAZone.isValidZone(zone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** 'HH:MM' or 'HH:MM:SS' -> 'HH:MM:SS', or null when invalid. */
export function normalizeTimeOfDay(raw: string): string | null {
  const m = TIME_OF_DAY.exec(raw.trim());
  if (!m) return null;
  return `${m[1]}:${m[2]}:${m[3] ?? '00'}`;
}

function dayStartDuration(dayStartsAt: string): { hours: number; minutes: number; seconds: number } {
  const [h = '0', m = '0', s = '0'] = dayStartsAt.split(':');
  return { hours: Number(h), minutes: Number(m), seconds: Number(s) };
}

/**
 * The logical date an instant counts in: the local date, in `timezone`, of
 * (instant - dayStartsAt). With dayStartsAt 00:00 it is simply the local calendar date.
 */
export function logicalDate(instant: Date, cfg: DayConfig): string {
  const local = DateTime.fromJSDate(instant, { zone: cfg.timezone }).minus(dayStartDuration(cfg.dayStartsAt));
  return local.toISODate() as string;
}

/** The instant at which logical day `isoDate` (YYYY-MM-DD) starts. */
export function logicalDayStart(isoDate: string, cfg: DayConfig): Date {
  const midnight = DateTime.fromISO(isoDate, { zone: cfg.timezone }).startOf('day');
  if (!midnight.isValid) throw badRequest(`Invalid date ${isoDate}`);
  return midnight.plus(dayStartDuration(cfg.dayStartsAt)).toJSDate();
}

/** [start, end) instants covering the logical days from..to (inclusive). */
export function logicalRange(from: string, to: string, cfg: DayConfig): { start: Date; end: Date } {
  return { start: logicalDayStart(from, cfg), end: logicalDayStart(addDays(to, 1), cfg) };
}

/** [start, end) instants of the logical month that contains `now`. */
export function logicalMonthRange(now: Date, cfg: DayConfig): { month: string; start: Date; end: Date } {
  const today = logicalDate(now, cfg);
  const first = `${today.slice(0, 7)}-01`;
  const next = DateTime.fromISO(first, { zone: 'UTC' }).plus({ months: 1 }).toISODate() as string;
  return { month: today.slice(0, 7), start: logicalDayStart(first, cfg), end: logicalDayStart(next, cfg) };
}

/** Plain calendar arithmetic on 'YYYY-MM-DD'. */
export function addDays(isoDate: string, days: number): string {
  return DateTime.fromISO(isoDate, { zone: 'UTC' }).plus({ days }).toISODate() as string;
}

export function isValidIsoDate(isoDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate) && DateTime.fromISO(isoDate, { zone: 'UTC' }).isValid;
}

export type GroupBy = 'day' | 'week' | 'month' | 'year';

/** Period key of a logical date: '2026-09-29', ISO week '2026-W40', month '2026-09', or year '2026'. */
export function periodOf(isoDate: string, groupBy: GroupBy): string {
  if (groupBy === 'day') return isoDate;
  if (groupBy === 'month') return isoDate.slice(0, 7);
  if (groupBy === 'year') return isoDate.slice(0, 4);
  const d = DateTime.fromISO(isoDate, { zone: 'UTC' });
  return `${String(d.weekYear).padStart(4, '0')}-W${String(d.weekNumber).padStart(2, '0')}`;
}

/** Every period touched by the logical days from..to, in order. */
export function periodsBetween(from: string, to: string, groupBy: GroupBy, maxPeriods: number): string[] {
  const periods: string[] = [];
  let cursor = DateTime.fromISO(from, { zone: 'UTC' });
  const last = DateTime.fromISO(to, { zone: 'UTC' });
  while (cursor <= last) {
    const key = periodOf(cursor.toISODate() as string, groupBy);
    if (periods[periods.length - 1] !== key) {
      periods.push(key);
      if (periods.length > maxPeriods) {
        throw badRequest(`The range from ${from} to ${to} has more than ${maxPeriods} periods; narrow it or group by a longer period`);
      }
    }
    // Jump to the start of the next period.
    if (groupBy === 'day') cursor = cursor.plus({ days: 1 });
    else if (groupBy === 'week') cursor = cursor.startOf('week').plus({ weeks: 1 });
    else if (groupBy === 'month') cursor = cursor.startOf('month').plus({ months: 1 });
    else cursor = cursor.startOf('year').plus({ years: 1 });
  }
  return periods;
}
