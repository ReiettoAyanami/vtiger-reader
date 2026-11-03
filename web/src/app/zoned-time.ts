/**
 * Wall times in a time zone (the settings' one, Europe/Rome), without a date library: the
 * browser's own zone never matters. A form shows "now" as the day and the time on the clocks of
 * that zone, and turns the day and the time typed there into the UTC instant the API stores.
 */

/** A day 'YYYY-MM-DD' and a time 'HH:MM' as the clocks of a time zone read them. */
export interface WallTime {
  day: string;
  time: string;
}

const MINUTE = 60_000;
const DAY = 86_400_000;

function clockOf(instant: Date, timeZone: string) {
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const part = Object.fromEntries(format.formatToParts(instant).map((p) => [p.type, Number(p.value)]));
  return part as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

/** The day and the time an instant reads on the clocks of `timeZone`. */
export function wallTimeOf(instant: Date, timeZone: string): WallTime {
  const c = clockOf(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { day: `${c.year}-${pad(c.month)}-${pad(c.day)}`, time: `${pad(c.hour)}:${pad(c.minute)}` };
}

/** How many minutes the clocks of `timeZone` are ahead of UTC at `instant` (ms since the epoch). */
function offsetMinutes(instant: number, timeZone: string): number {
  const c = clockOf(new Date(instant), timeZone);
  const asUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / MINUTE);
}

/**
 * The instant at which the clocks of `timeZone` read `wall`. A time the clocks skip (spring
 * forward) lands an hour later; a time they read twice (fall back) is the first of the two.
 */
export function instantOf(wall: WallTime, timeZone: string): Date {
  const [year, month, day] = wall.day.split('-').map(Number);
  const [hour, minute] = wall.time.split(':').map(Number);
  const asUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  // The zone's offsets a day before and a day after cover any change of the clocks in between.
  const offsets = new Set([offsetMinutes(asUtc - DAY, timeZone), offsetMinutes(asUtc + DAY, timeZone)]);
  const candidates = [...offsets].map((offset) => asUtc - offset * MINUTE);
  const reading = candidates.filter((candidate) => {
    const read = wallTimeOf(new Date(candidate), timeZone);
    return read.day === wall.day && read.time === wall.time;
  });
  return new Date(reading.length > 0 ? Math.min(...reading) : Math.max(...candidates));
}
