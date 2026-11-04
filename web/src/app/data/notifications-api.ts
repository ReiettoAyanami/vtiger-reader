import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { Bell, NotificationSettings, SubscriptionInput } from './notifications';

/** Gateway of the user's notifications and push (/api/notifications, /api/push): no state, no logic. */
@Injectable({
  providedIn: 'root',
})
export class NotificationsApi {
  private readonly http = inject(HttpClient);

  /** GET /api/notifications/settings */
  settings(): Observable<NotificationSettings> {
    return this.http.get<NotificationSettings>('/api/notifications/settings');
  }

  /** PUT /api/notifications/settings: on/off and exactly these lists. */
  updateSettings(enabled: boolean, lists: number[]): Observable<NotificationSettings> {
    return this.http.put<NotificationSettings>('/api/notifications/settings', { enabled, lists });
  }

  /** GET /api/notifications: the bell, read from the CRM. */
  bell(): Observable<Bell> {
    return this.http.get<Bell>('/api/notifications');
  }

  /** POST /api/notifications/seen: the bell was opened, up to this creation time (ISO). 204. */
  seen(upTo: string): Observable<void> {
    return this.http.post<void>('/api/notifications/seen', { upTo }).pipe(map(() => undefined));
  }

  /** GET /api/push/key: the server's public VAPID key (base64url). */
  publicKey(): Observable<string> {
    return this.http.get<{ publicKey: string }>('/api/push/key').pipe(map((r) => r.publicKey));
  }

  /** PUT /api/push/subscription: this browser gets the user's notifications. 204. */
  subscribe(subscription: SubscriptionInput): Observable<void> {
    return this.http.put<void>('/api/push/subscription', subscription).pipe(map(() => undefined));
  }

  /** POST /api/push/subscription/delete: this browser no longer does. 204. */
  unsubscribe(endpoint: string): Observable<void> {
    return this.http
      .post<void>('/api/push/subscription/delete', { endpoint })
      .pipe(map(() => undefined));
  }

  /** POST /api/push/test: a notification to every browser of the user; how many got it. */
  test(): Observable<number> {
    return this.http.post<{ sent: number }>('/api/push/test', {}).pipe(map((r) => r.sent));
  }
}
