import type { Owner } from '../../shared/owner.js';

/** What a notification says, and the page of the app a click opens. */
export interface NotificationMessage {
  title: string;
  body: string;
  /** The page of the app a click opens: '/tickets/17x1', '/'. */
  url: string;
  /** One tag per profile: a newer notification replaces the one still shown. */
  tag: string;
}

/**
 * Where the notifications go (plan 7.2): the desktop app shows them as the system's own
 * notifications (Electron); the bare dev server writes them to its log; the tests keep them.
 * Answers whether it was shown.
 */
export interface Notifier {
  show(owner: Owner, message: NotificationMessage): boolean | Promise<boolean>;
}

/** The bare server's: a log line, since it has no desktop to show it on. Never "shown". */
export function logNotifier(log: { info: (message: string) => void }): Notifier {
  return {
    show: (_owner, message) => {
      log.info(`notification (not shown, no desktop): ${message.title} | ${message.body} | ${message.url}`);
      return false;
    },
  };
}
