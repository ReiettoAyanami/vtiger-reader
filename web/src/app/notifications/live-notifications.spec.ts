import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { SessionUser } from '../data/auth-api';
import { Session } from '../session/session';
import { EVENT_SOURCE, LiveNotifications, STREAM_URL } from './live-notifications';

/** A fake EventSource: its listeners, whether it was closed. */
class FakeSource {
  readonly listeners = new Map<string, Array<() => void>>();
  closed = false;
  constructor(readonly url: string) {}
  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  close(): void {
    this.closed = true;
  }
}

describe('LiveNotifications', () => {
  function setup() {
    const user = signal<SessionUser | null>(null);
    const sources: FakeSource[] = [];
    TestBed.configureTestingModule({
      providers: [
        { provide: Session, useValue: { user } },
        {
          provide: EVENT_SOURCE,
          useValue: (url: string) => {
            const source = new FakeSource(url);
            sources.push(source);
            return source as unknown as EventSource;
          },
        },
      ],
    });
    const live = TestBed.inject(LiveNotifications);
    TestBed.tick();
    return { live, user, sources };
  }

  const lenzi: SessionUser = { id: 1, username: 'lenzi', role: 'user', impersonatedBy: null };

  it('no user: no stream', () => {
    const { sources } = setup();
    expect(sources).toEqual([]);
  });

  it('a user: one stream; its events and reconnections move arrivals', () => {
    const { live, user, sources } = setup();
    user.set(lenzi);
    TestBed.tick();
    expect(sources.map((s) => s.url)).toEqual([STREAM_URL]);
    const before = live.arrivals();
    sources[0].emit('ready');
    sources[0].emit('tickets');
    expect(live.arrivals()).toBe(before + 2);
  });

  it('signed out, or another user: the stream is closed (and a new one for the new user)', () => {
    const { user, sources } = setup();
    user.set(lenzi);
    TestBed.tick();
    user.set({ ...lenzi, impersonatedBy: 9 });
    TestBed.tick();
    expect(sources.length).toBe(2);
    expect(sources[0].closed).toBe(true);
    user.set(null);
    TestBed.tick();
    expect(sources[1].closed).toBe(true);
    expect(sources.length).toBe(2);
  });
});
