// The display choices this browser remembers for every panel (a scale, a period): localStorage,
// never the database. A plain module (no schematic makes one).

/** A remembered choice, if it is still a valid one; otherwise, or when the browser keeps nothing, the fallback. */
export function readPreference<T>(key: string, valid: (value: string) => T | null, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return (stored === null ? null : valid(stored)) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Remembers a choice. */
export function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered: the panel still changes.
  }
}
