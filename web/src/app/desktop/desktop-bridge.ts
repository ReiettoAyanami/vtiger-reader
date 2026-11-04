import { Injectable, InjectionToken, inject } from '@angular/core';
import { Router } from '@angular/router';

/**
 * What the desktop app's main process gives the page (api/src/desktop/preload.cts), as
 * window.vtigerDesktop; absent in a plain browser (ng serve, the bare dev server).
 */
export interface VtigerDesktop {
  onOpen(listener: (path: string) => void): void;
  getStartAtLogin(): Promise<boolean>;
  setStartAtLogin(on: boolean): Promise<boolean>;
}

export const VTIGER_DESKTOP = new InjectionToken<VtigerDesktop | null>('VTIGER_DESKTOP', {
  providedIn: 'root',
  factory: () =>
    (typeof window === 'undefined'
      ? null
      : (window as unknown as { vtigerDesktop?: VtigerDesktop }).vtigerDesktop) ?? null,
});

/** Is this a path of the app itself ('/tickets/17x1'), not another site ('//evil', 'https:')? */
export function isAppPath(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    url.startsWith('/') &&
    !url.startsWith('//') &&
    !url.startsWith('/\\')
  );
}

/**
 * The page's side of the desktop app (plan 7.4): a notification clicked while the window is open
 * opens its ticket here, without reloading; the app may start with Windows, in the tray.
 */
@Injectable({
  providedIn: 'root',
})
export class DesktopBridge {
  private readonly desktop = inject(VTIGER_DESKTOP);
  private readonly router = inject(Router);
  private listening = false;

  /** In the desktop app (false in a plain browser). */
  readonly available = this.desktop !== null;

  /** Hears the main process's "open this page" (once). */
  listen(): void {
    if (!this.desktop || this.listening) return;
    this.listening = true;
    this.desktop.onOpen((path) => {
      if (isAppPath(path)) void this.router.navigateByUrl(path);
    });
  }

  async startAtLogin(): Promise<boolean> {
    return this.desktop ? this.desktop.getStartAtLogin() : false;
  }

  /** Turns it on or off; answers what the system now has. */
  async setStartAtLogin(on: boolean): Promise<boolean> {
    return this.desktop ? this.desktop.setStartAtLogin(on) : false;
  }
}
