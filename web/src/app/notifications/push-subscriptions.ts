import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { SubscriptionInput } from '../data/notifications';
import { NotificationsApi } from '../data/notifications-api';

/** The browser's pieces push needs, apart so that tests can give their own; null without push. */
export interface PushBrowser {
  container: ServiceWorkerContainer;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
}

export const PUSH_BROWSER = new InjectionToken<PushBrowser | null>('PUSH_BROWSER', {
  providedIn: 'root',
  factory: () => {
    if (
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) ||
      typeof window === 'undefined' ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      return null;
    }
    return {
      container: navigator.serviceWorker,
      permission: () => Notification.permission,
      requestPermission: () => Notification.requestPermission(),
    };
  },
});

/** The service worker, from public/: it only shows notifications and opens their page. */
export const WORKER_URL = '/push-sw.js';

/**
 * This browser and push: cannot (no support, or the user blocked the site), off, on; unknown until
 * the first look.
 */
export type PushState = 'unknown' | 'unsupported' | 'blocked' | 'off' | 'on';

/** A base64url VAPID key as the bytes PushManager.subscribe wants. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replaceAll('-', '+').replaceAll('_', '/');
  const text = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** Is this a path of the app itself ('/lenzi/tickets/17x1'), not another site ('//evil', 'https:')? */
export function isAppPath(url: unknown): url is string {
  return (
    typeof url === 'string' &&
    url.startsWith('/') &&
    !url.startsWith('//') &&
    !url.startsWith('/\\')
  );
}

/**
 * Web Push in this browser (plan 5.3): turning it on asks the browser's permission, registers the
 * service worker and gives the API the subscription; off ends it on both sides. A click on a
 * notification, with the app open, arrives here and opens the ticket without reloading.
 */
@Injectable({
  providedIn: 'root',
})
export class PushSubscriptions {
  private readonly api = inject(NotificationsApi);
  private readonly browser = inject(PUSH_BROWSER);
  private readonly router = inject(Router);

  private readonly current = signal<PushState>('unknown');
  readonly state = this.current.asReadonly();
  private listening = false;

  /** Hears the service worker's "open this page" (a notification clicked while the app is open). */
  listen(): void {
    if (!this.browser || this.listening) return;
    this.listening = true;
    this.browser.container.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (data?.type === 'open' && isAppPath(data.url)) void this.router.navigateByUrl(data.url);
    });
  }

  /** Looks at what this browser has now. */
  async refresh(): Promise<PushState> {
    const subscription = await this.subscription().catch(() => null);
    this.current.set(this.stateWith(subscription));
    return this.current();
  }

  /**
   * Turns push on: the browser's permission (asked only here, after the user's click), the worker,
   * a subscription with the server's key, given to the API. Rejects when a step fails.
   */
  async enable(): Promise<PushState> {
    const browser = this.browser;
    if (!browser) return this.set('unsupported');
    const permission = await browser.requestPermission();
    if (permission !== 'granted') return this.set(permission === 'denied' ? 'blocked' : 'off');
    const registration = await browser.container.register(WORKER_URL, { scope: '/' });
    const key = await firstValueFrom(this.api.publicKey());
    // An old subscription may carry another key (the server's was made again): a new one.
    const old = await registration.pushManager.getSubscription();
    if (old) await old.unsubscribe();
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key),
    });
    try {
      await firstValueFrom(this.api.subscribe(subscription.toJSON() as SubscriptionInput));
    } catch (error) {
      // The API refused it: the browser must not stay subscribed for nothing.
      await subscription.unsubscribe().catch(() => undefined);
      this.set('off');
      throw error;
    }
    return this.set('on');
  }

  /** Turns push off in this browser, and tells the API (which forgets it anyway when it is dead). */
  async disable(): Promise<PushState> {
    const subscription = await this.subscription().catch(() => null);
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe().catch(() => undefined);
      await firstValueFrom(this.api.unsubscribe(endpoint)).catch(() => undefined);
    }
    return this.set(this.stateWith(null));
  }

  private async subscription(): Promise<PushSubscription | null> {
    if (!this.browser) return null;
    const registration = await this.browser.container.getRegistration('/');
    return (await registration?.pushManager.getSubscription()) ?? null;
  }

  private stateWith(subscription: PushSubscription | null): PushState {
    if (!this.browser) return 'unsupported';
    if (this.browser.permission() === 'denied') return 'blocked';
    return subscription ? 'on' : 'off';
  }

  private set(state: PushState): PushState {
    this.current.set(state);
    return state;
  }
}
