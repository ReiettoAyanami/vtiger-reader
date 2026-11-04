import { TestBed } from '@angular/core/testing';

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
  function setup(supported = true) {
    const sources: FakeSource[] = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: EVENT_SOURCE,
          useValue: (url: string) => {
            if (!supported) return null;
            const source = new FakeSource(url);
            sources.push(source);
            return source as unknown as EventSource;
          },
        },
      ],
    });
    const live = TestBed.inject(LiveNotifications);
    return { live, sources };
  }

  it('one stream; its events and reconnections move arrivals', () => {
    const { live, sources } = setup();
    expect(sources.map((s) => s.url)).toEqual([STREAM_URL]);
    sources[0].emit('ready');
    sources[0].emit('tickets');
    expect(live.arrivals()).toBe(2);
  });

  it('closed with the app', () => {
    const { sources } = setup();
    TestBed.resetTestingModule();
    expect(sources[0].closed).toBe(true);
  });

  it('no stream in this browser: arrivals stay still', () => {
    const { live } = setup(false);
    expect(live.arrivals()).toBe(0);
  });
});
