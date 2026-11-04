import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { Bell, NotificationSettings } from './notifications';

/** Gateway of the profile's notifications (/api/notifications): no state, no logic. */
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

  /** POST /api/notifications/test: a notification on this PC; whether the desktop showed it. */
  test(): Observable<boolean> {
    return this.http
      .post<{ shown: boolean }>('/api/notifications/test', {})
      .pipe(map((r) => r.shown));
  }
}
