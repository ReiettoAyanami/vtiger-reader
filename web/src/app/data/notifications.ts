/** The profile's notifications, as /api/notifications gives them (api/src/modules/notifications/service.ts). */

import { TicketRow } from './tickets';

/** GET/PUT /api/notifications/settings */
export interface NotificationSettings {
  enabled: boolean;
  /** The ids of the user's lists a new ticket notifies them from. */
  lists: number[];
}

/** GET /api/notifications: the tickets created since the user last opened the bell, newest first. */
export interface Bell {
  enabled: boolean;
  items: TicketRow[];
}
