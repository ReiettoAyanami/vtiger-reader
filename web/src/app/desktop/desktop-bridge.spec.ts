import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { DesktopBridge, VTIGER_DESKTOP, VtigerDesktop, isAppPath } from './desktop-bridge';

describe('isAppPath', () => {
  it('only paths of the app itself', () => {
    expect(isAppPath('/tickets/17x1')).toBe(true);
    expect(isAppPath('/')).toBe(true);
    expect(isAppPath('//evil.example/x')).toBe(false);
    expect(isAppPath('/\\evil.example')).toBe(false);
    expect(isAppPath('https://evil.example')).toBe(false);
    expect(isAppPath(42)).toBe(false);
  });
});

describe('DesktopBridge', () => {
  function setup(desktop: VtigerDesktop | null) {
    const navigate = vi.fn(async () => true);
    TestBed.configureTestingModule({
      providers: [
        { provide: VTIGER_DESKTOP, useValue: desktop },
        { provide: Router, useValue: { navigateByUrl: navigate } },
      ],
    });
    return { bridge: TestBed.inject(DesktopBridge), navigate };
  }

  function fakeDesktop() {
    const listeners: Array<(path: string) => void> = [];
    let atLogin = false;
    const desktop: VtigerDesktop = {
      onOpen: (listener) => listeners.push(listener),
      getStartAtLogin: async () => atLogin,
      setStartAtLogin: async (on) => (atLogin = on),
    };
    return { desktop, listeners };
  }

  it('in a plain browser: nothing to hear, no start with Windows', async () => {
    const { bridge } = setup(null);
    expect(bridge.available).toBe(false);
    bridge.listen();
    expect(await bridge.startAtLogin()).toBe(false);
    expect(await bridge.setStartAtLogin(true)).toBe(false);
  });

  it("a clicked notification opens the app's page, nothing else; heard once", () => {
    const fake = fakeDesktop();
    const { bridge, navigate } = setup(fake.desktop);
    expect(bridge.available).toBe(true);
    bridge.listen();
    bridge.listen();
    expect(fake.listeners).toHaveLength(1);
    fake.listeners[0]('/tickets/17x1');
    fake.listeners[0]('https://evil.example');
    expect(navigate.mock.calls).toEqual([['/tickets/17x1']]);
  });

  it('start with Windows: read and set through the main process', async () => {
    const { bridge } = setup(fakeDesktop().desktop);
    expect(await bridge.startAtLogin()).toBe(false);
    expect(await bridge.setStartAtLogin(true)).toBe(true);
    expect(await bridge.startAtLogin()).toBe(true);
  });
});
