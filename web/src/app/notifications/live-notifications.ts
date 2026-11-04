import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';

/** Opens a server-sent events stream; null in a browser without them. Tests give their own. */
export const EVENT_SOURCE = new InjectionToken<(url: string) => EventSource | null>(
  'EVENT_SOURCE',
  {
    providedIn: 'root',
    factory: () => (url: string) =>
      typeof EventSource === 'undefined' ? null : new EventSource(url),
  },
);

export const STREAM_URL = '/api/notifications/stream';

/**
 * The open app hears the new tickets (plan 5.3, "live update through SSE when it is open"): one
 * stream from the first use to the end (one profile, no sign-out: plan 7.1). Every "tickets" event,
 * and every new connection (one may have been missed while it was down), moves `arrivals`: whoever
 * shows tickets (the bell) reads again.
 */
@Injectable({
  providedIn: 'root',
})
export class LiveNotifications {
  private readonly counter = signal(0);
  readonly arrivals = this.counter.asReadonly();

  constructor() {
    const source = inject(EVENT_SOURCE)(STREAM_URL);
    // No stream in this browser: the bell is read when the page opens, not live.
    if (!source) return;
    const bump = () => this.counter.update((n) => n + 1);
    source.addEventListener('tickets', bump);
    // 'ready' arrives at every (re)connection: what came while it was down is read again.
    source.addEventListener('ready', bump);
    inject(DestroyRef).onDestroy(() => source.close());
  }
}
