import {
  DestroyRef,
  Injectable,
  InjectionToken,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

import { Session } from '../session/session';

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
 * The open page hears the new tickets (plan 5.3, "live update through SSE when it is open"): one
 * stream while a user is signed in, closed when they sign out or another user takes over. Every
 * "tickets" event, and every new connection (one may have been missed while it was down), moves
 * `arrivals`: whoever shows tickets (the bell) reads again.
 */
@Injectable({
  providedIn: 'root',
})
export class LiveNotifications {
  private readonly session = inject(Session);
  private readonly open = inject(EVENT_SOURCE);

  private readonly counter = signal(0);
  readonly arrivals = this.counter.asReadonly();

  private source: EventSource | null = null;

  constructor() {
    effect(() => {
      const user = this.session.user();
      const who = user ? `${user.username}|${user.impersonatedBy ?? ''}` : null;
      untracked(() => this.connect(who));
    });
    inject(DestroyRef).onDestroy(() => this.connect(null));
  }

  private connected: string | null = null;

  private connect(who: string | null): void {
    if (who === this.connected) return;
    this.source?.close();
    this.source = null;
    this.connected = who;
    if (!who) return;
    const source = this.open(STREAM_URL);
    // No stream in this browser: the bell is read when the page opens, not live.
    if (!source) return;
    const bump = () => this.counter.update((n) => n + 1);
    source.addEventListener('tickets', bump);
    // 'ready' arrives at every (re)connection: what came while it was down is read again.
    source.addEventListener('ready', bump);
    this.source = source;
  }
}
