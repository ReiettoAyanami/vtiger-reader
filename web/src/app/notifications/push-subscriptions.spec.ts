import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { NotificationsApi } from '../data/notifications-api';
import {
  PUSH_BROWSER,
  PushBrowser,
  PushSubscriptions,
  WORKER_URL,
  isAppPath,
  keyBytes,
} from './push-subscriptions';

/** A fake browser: one registration whose push manager keeps at most one subscription. */
function fakeBrowser(
  permission: NotificationPermission = 'default',
  answer: NotificationPermission = 'granted',
) {
  let current: {
    endpoint: string;
    unsubscribe: () => Promise<boolean>;
    toJSON: () => object;
  } | null = null;
  let registered = false;
  const listeners: Array<(event: MessageEvent) => void> = [];
  const make = (endpoint: string) => {
    const sub = {
      endpoint,
      unsubscribe: vi.fn(async () => {
        if (current === sub) current = null;
        return true;
      }),
      toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
    };
    return sub;
  };
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => (current = make(`https://push.example/${Math.random()}`))),
  };
  const registration = { pushManager };
  const browser = {
    container: {
      register: vi.fn(async () => ((registered = true), registration)),
      getRegistration: vi.fn(async () => (registered ? registration : undefined)),
      addEventListener: (_: string, listener: (event: MessageEvent) => void) =>
        listeners.push(listener),
    } as unknown as ServiceWorkerContainer,
    permission: () => permission,
    requestPermission: vi.fn(async () => (permission = answer)),
  } satisfies PushBrowser;
  return {
    browser,
    pushManager,
    listeners,
    current: () => current,
    preset: (endpoint: string) => {
      registered = true;
      current = make(endpoint);
    },
  };
}

function setup(browser: PushBrowser | null, api: Partial<NotificationsApi> = {}) {
  const navigate = vi.fn(async () => true);
  const calls = {
    subscribe: vi.fn(() => of(undefined)),
    unsubscribe: vi.fn(() => of(undefined)),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: PUSH_BROWSER, useValue: browser },
      { provide: Router, useValue: { navigateByUrl: navigate } },
      {
        provide: NotificationsApi,
        useValue: { publicKey: () => of('AQID'), ...calls, ...api },
      },
    ],
  });
  return { push: TestBed.inject(PushSubscriptions), navigate, calls };
}

describe('keyBytes and isAppPath', () => {
  it('a base64url key as bytes', () => {
    expect([...keyBytes('AQID')]).toEqual([1, 2, 3]);
    expect([...keyBytes('-_8')]).toEqual([251, 255]);
  });

  it('only paths of the app itself', () => {
    expect(isAppPath('/lenzi/tickets/17x1')).toBe(true);
    expect(isAppPath('//evil.example/x')).toBe(false);
    expect(isAppPath('/\\evil.example')).toBe(false);
    expect(isAppPath('https://evil.example')).toBe(false);
    expect(isAppPath(42)).toBe(false);
  });
});

describe('PushSubscriptions', () => {
  it('no push in this browser: unsupported, and nothing asked', async () => {
    const { push, calls } = setup(null);
    expect(await push.refresh()).toBe('unsupported');
    expect(await push.enable()).toBe('unsupported');
    expect(calls.subscribe).not.toHaveBeenCalled();
  });

  it('on: asks the permission, registers the worker, gives the API the subscription', async () => {
    const fake = fakeBrowser();
    const { push, calls } = setup(fake.browser);
    expect(await push.refresh()).toBe('off');
    expect(await push.enable()).toBe('on');
    expect(fake.browser.container.register).toHaveBeenCalledWith(WORKER_URL, { scope: '/' });
    expect(fake.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: keyBytes('AQID'),
    });
    expect(calls.subscribe).toHaveBeenCalledWith(fake.current()!.toJSON());
    expect(push.state()).toBe('on');
  });

  it('an old subscription is replaced (the server key may have changed)', async () => {
    const fake = fakeBrowser('granted');
    fake.preset('https://push.example/old');
    const { push } = setup(fake.browser);
    expect(await push.refresh()).toBe('on');
    await push.enable();
    expect(fake.current()!.endpoint).not.toBe('https://push.example/old');
  });

  it('the permission refused: blocked, no subscription', async () => {
    const fake = fakeBrowser('default', 'denied');
    const { push, calls } = setup(fake.browser);
    expect(await push.enable()).toBe('blocked');
    expect(fake.pushManager.subscribe).not.toHaveBeenCalled();
    expect(calls.subscribe).not.toHaveBeenCalled();
  });

  it('the API refuses the subscription: the browser does not stay subscribed', async () => {
    const fake = fakeBrowser();
    const { push } = setup(fake.browser, { subscribe: () => throwError(() => new Error('no')) });
    await expect(push.enable()).rejects.toThrow('no');
    expect(fake.current()).toBeNull();
    expect(push.state()).toBe('off');
  });

  it('off: ends the subscription here and tells the API', async () => {
    const fake = fakeBrowser('granted');
    fake.preset('https://push.example/1');
    const { push, calls } = setup(fake.browser);
    expect(await push.disable()).toBe('off');
    expect(fake.current()).toBeNull();
    expect(calls.unsubscribe).toHaveBeenCalledWith('https://push.example/1');
  });

  it("a notification clicked with the app open: opens the app's page, nothing else", async () => {
    const fake = fakeBrowser();
    const { push, navigate } = setup(fake.browser);
    push.listen();
    push.listen();
    expect(fake.listeners.length).toBe(1);
    const send = (data: unknown) => fake.listeners[0]({ data } as MessageEvent);
    send({ type: 'open', url: '/lenzi/tickets/17x1' });
    send({ type: 'open', url: 'https://evil.example' });
    send({ type: 'other', url: '/lenzi' });
    send(null);
    expect(navigate.mock.calls).toEqual([['/lenzi/tickets/17x1']]);
  });
});
