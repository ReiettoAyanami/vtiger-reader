import type { NotificationMessage, Notifier } from '../../src/modules/notifications/notifier.js';
import type { Owner } from '../../src/shared/owner.js';

/**
 * The desktop's notifications, kept instead of shown. `works` false: a desktop that does not show
 * them (Windows' notifications turned off for the app).
 */
export class FakeNotifier implements Notifier {
  readonly shown: Array<{ userId: number; message: NotificationMessage }> = [];
  works = true;

  show = (owner: Owner, message: NotificationMessage): boolean => {
    this.shown.push({ userId: owner.userId, message });
    return this.works;
  };
}
