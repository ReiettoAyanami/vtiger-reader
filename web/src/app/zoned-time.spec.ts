import { instantOf, wallTimeOf } from './zoned-time';

const ROME = 'Europe/Rome';
const iso = (date: Date) => date.toISOString().replace('.000', '');

describe('zoned time', () => {
  it('reads an instant on the clocks of a zone, the day included', () => {
    expect(wallTimeOf(new Date('2026-09-28T06:45:00Z'), ROME)).toEqual({ day: '2026-09-28', time: '08:45' });
    expect(wallTimeOf(new Date('2026-09-28T22:30:00Z'), ROME)).toEqual({ day: '2026-09-29', time: '00:30' });
    expect(wallTimeOf(new Date('2026-01-15T19:00:00Z'), ROME)).toEqual({ day: '2026-01-15', time: '20:00' });
  });

  it('turns a day and a time on the clocks of a zone into the instant, summer and winter', () => {
    expect(iso(instantOf({ day: '2026-09-28', time: '08:45' }, ROME))).toBe('2026-09-28T06:45:00Z');
    expect(iso(instantOf({ day: '2026-09-30', time: '00:30' }, ROME))).toBe('2026-09-29T22:30:00Z');
    expect(iso(instantOf({ day: '2026-01-15', time: '20:00' }, ROME))).toBe('2026-01-15T19:00:00Z');
    expect(iso(instantOf({ day: '2026-07-04', time: '12:00' }, 'America/New_York'))).toBe('2026-07-04T16:00:00Z');
  });

  it('the day the clocks go forward, a skipped time lands an hour later', () => {
    // 29 March 2026: in Rome 02:00 becomes 03:00
    expect(iso(instantOf({ day: '2026-03-29', time: '01:30' }, ROME))).toBe('2026-03-29T00:30:00Z');
    expect(iso(instantOf({ day: '2026-03-29', time: '02:30' }, ROME))).toBe('2026-03-29T01:30:00Z'); // reads 03:30
    expect(iso(instantOf({ day: '2026-03-29', time: '03:30' }, ROME))).toBe('2026-03-29T01:30:00Z');
  });

  it('the day the clocks go back, a time read twice is the first of the two', () => {
    // 25 October 2026: in Rome 03:00 becomes 02:00 again
    expect(iso(instantOf({ day: '2026-10-25', time: '02:30' }, ROME))).toBe('2026-10-25T00:30:00Z');
    expect(iso(instantOf({ day: '2026-10-25', time: '03:30' }, ROME))).toBe('2026-10-25T02:30:00Z');
  });

  it('goes back and forth without drifting', () => {
    for (const instant of ['2026-02-01T11:59:00Z', '2026-06-21T23:01:00Z', '2026-12-31T23:00:00Z']) {
      expect(iso(instantOf(wallTimeOf(new Date(instant), ROME), ROME))).toBe(instant);
    }
  });
});
