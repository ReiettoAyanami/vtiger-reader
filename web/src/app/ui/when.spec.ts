import { formatWhen } from './when';

describe('formatWhen', () => {
  const now = new Date('2026-11-03T15:00:00Z');

  it('today: the time only, in the time zone', () => {
    expect(formatWhen('2026-11-03T10:00:00Z', 'Europe/Rome', now)).toBe('11:00');
    expect(formatWhen('2026-11-03T10:00:00Z', 'UTC', now)).toBe('10:00');
  });

  it('this year: day and month; before: the year too', () => {
    expect(formatWhen('2026-10-01T08:30:00Z', 'Europe/Rome', now)).toBe('1 Oct, 10:30');
    expect(formatWhen('2025-12-31T23:30:00Z', 'Europe/Rome', now)).toBe('1 Jan, 00:30');
    expect(formatWhen('2024-05-02T08:30:00Z', 'Europe/Rome', now)).toBe('2 May 2024, 10:30');
  });

  it('nothing for no date', () => {
    expect(formatWhen(null, 'Europe/Rome', now)).toBe('');
    expect(formatWhen('not a date', 'Europe/Rome', now)).toBe('');
  });
});
