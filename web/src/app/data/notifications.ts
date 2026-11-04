/** The user's notifications, as /api/notifications gives them (api/src/modules/notifications/service.ts). */

import { TicketRow } from './tickets';

/** GET/PUT /api/notifications/settings */
export interface NotificationSettings {
  enabled: boolean;
  /** The ids of the user's lists a new ticket notifies them from. */
  lists: number[];
  /** How many browsers / devices get push notifications (answer only). */
  devices: number;
}

/** GET /api/notifications: the tickets created since the user last opened the bell, newest first. */
export interface Bell {
  enabled: boolean;
  items: TicketRow[];
}

/** What a browser gives when it allows push notifications (PushSubscription.toJSON()). */
export interface SubscriptionInput {
  endpoint: string;
  expirationTime?: number | null;
  keys: { p256dh: string; auth: string };
}
