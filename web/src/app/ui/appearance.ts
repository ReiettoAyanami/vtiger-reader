import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';

import { readPreference, writePreference } from './preferences';

const REDUCE_TRANSPARENCY_KEY = 'vtiger-reader.reduce-transparency';

/**
 * How the app looks on this browser. Today one choice: "Reduce transparency" (lenzi, 2026-10-01),
 * like Android's own switch. Windows, menus and bars are see-through and blur what is under them
 * (styles.css, "glass"); reduced, they are solid again. It marks <html> with `reduce-transparency`,
 * which styles.css reads; the system's own wish (prefers-reduced-transparency) is followed there
 * too. A display choice: this browser remembers it, never the database.
 */
@Injectable({
  providedIn: 'root',
})
export class Appearance {
  private readonly document = inject(DOCUMENT);

  readonly reduceTransparency = signal(
    readPreference<boolean>(REDUCE_TRANSPARENCY_KEY, (v) => (v === 'true' ? true : v === 'false' ? false : null), false),
  );

  constructor() {
    effect(() => this.document.documentElement.classList.toggle('reduce-transparency', this.reduceTransparency()));
  }

  setReduceTransparency(reduce: boolean): void {
    this.reduceTransparency.set(reduce);
    writePreference(REDUCE_TRANSPARENCY_KEY, String(reduce));
  }
}
