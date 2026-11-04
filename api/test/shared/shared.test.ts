import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ProblemError } from '../../src/shared/errors.js';
import {
  logicalDate,
  logicalDayStart,
  normalizeTimeOfDay,
  parseInstant,
  periodOf,
  periodsBetween,
  toIso,
} from '../../src/shared/time.js';

const rome = { timezone: 'Europe/Rome', dayStartsAt: '00:00:00' };

describe('time', () => {
  it('logicalDate: local date of (instant − dayStartsAt) in the zone', () => {
    expect(logicalDate(new Date('2026-03-28T23:30:00Z'), rome)).toBe('2026-03-29');
    expect(logicalDate(new Date('2026-03-28T22:59:59Z'), rome)).toBe('2026-03-28');
    expect(logicalDate(new Date('2026-07-01T21:59:59Z'), rome)).toBe('2026-07-01');
    expect(logicalDate(new Date('2026-07-01T22:00:00Z'), rome)).toBe('2026-07-02');
    const early = { timezone: 'Europe/Rome', dayStartsAt: '04:00:00' };
    expect(logicalDate(new Date('2026-07-02T01:59:00Z'), early)).toBe('2026-07-01'); // 03:59 local
    expect(logicalDate(new Date('2026-07-02T02:00:00Z'), early)).toBe('2026-07-02'); // 04:00 local
  });

  it('logicalDayStart is the inverse boundary', () => {
    expect(logicalDayStart('2026-03-29', rome).toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(logicalDayStart('2026-03-30', rome).toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(logicalDayStart('2026-10-26', rome).toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('periods', () => {
    expect(periodOf('2026-09-29', 'day')).toBe('2026-09-29');
    expect(periodOf('2026-09-29', 'week')).toBe('2026-W40');
    expect(periodOf('2026-09-29', 'month')).toBe('2026-09');
    expect(periodOf('2027-01-01', 'week')).toBe('2026-W53');
    expect(periodsBetween('2026-01-30', '2026-03-01', 'month', 100)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(() => periodsBetween('2020-01-01', '2026-01-01', 'day', 100)).toThrow(ProblemError);
  });

  it('parseInstant needs an offset and returns UTC', () => {
    expect(toIso(parseInstant('2026-09-29T23:40:00+02:00'))).toBe('2026-09-29T21:40:00Z');
    expect(toIso(parseInstant('2026-09-29T21:40:00.999Z'))).toBe('2026-09-29T21:40:00Z');
    expect(() => parseInstant('2026-09-29T21:40:00')).toThrow(ProblemError);
    expect(() => parseInstant('2026-13-01T00:00:00Z')).toThrow(ProblemError);
  });

  it('normalizeTimeOfDay', () => {
    expect(normalizeTimeOfDay('04:00')).toBe('04:00:00');
    expect(normalizeTimeOfDay('23:59:59')).toBe('23:59:59');
    expect(normalizeTimeOfDay('24:00')).toBeNull();
  });
});

describe('source rules', () => {
  const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));

  async function sources(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await sources(full)));
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  }

  it('there is no SQL DELETE (or TRUNCATE) anywhere in src/, except for keys and preferences', async () => {
    for (const file of await sources(srcDir)) {
      // Unlinking a CRM account deletes its row: the sealed access key is not
      // kept once the user takes it back (crm/repository.ts). Taking back an image mark deletes it: a
      // preference, not a record (tickets/repository.ts); so is deleting one of one's lists
      // (lists/repository.ts), an AI provider or a task's own model (ai/repository.ts).
      const normalized = file.replace(/\\/g, '/');
      if (
        normalized.endsWith('/src/modules/crm/repository.ts') ||
        normalized.endsWith('/src/modules/tickets/repository.ts') ||
        normalized.endsWith('/src/modules/lists/repository.ts') ||
        normalized.endsWith('/src/modules/ai/repository.ts')
      ) {
        continue;
      }
      const text = await readFile(file, 'utf8');
      expect(text, file).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(text, file).not.toMatch(/\bTRUNCATE\b/i);
    }
  });

  it('an Owner is made only by the local profile', async () => {
    // The owner of a request is always the app's one profile (plan 7.1): nothing else may make one,
    // or a domain call could work for whoever a URL or a body names.
    // The one exception: the checks for new tickets (plan 5.1) run with no request, for each user
    // with a CRM link, as the database lists them (notifications/repository.ts, listWatchedUsers).
    const allowed = [
      '/src/shared/owner.ts',
      '/src/modules/profile/profile.ts',
      '/src/modules/notifications/repository.ts',
    ];
    for (const file of await sources(srcDir)) {
      const normalized = file.replace(/\\/g, '/');
      if (allowed.some((end) => normalized.endsWith(end))) continue;
      const text = await readFile(file, 'utf8');
      expect(text, file).not.toMatch(/\bownerOf\s*\(/);
    }
  });

  it('SQL lives only in repository.ts files and the db folder', async () => {
    for (const file of await sources(srcDir)) {
      const normalized = file.replace(/\\/g, '/');
      if (normalized.endsWith('/repository.ts') || normalized.includes('/src/db/')) continue;
      // VTQL, the CRM's query language (not our database's), is written in one file only.
      if (normalized.endsWith('/src/modules/crm/vtql.ts')) continue;
      const text = await readFile(file, 'utf8');
      expect(text, file).not.toMatch(/\b(SELECT\s+\S+.*\bFROM|INSERT\s+INTO|UPDATE\s+\w+\s+SET)\b/i);
    }
  });
});
