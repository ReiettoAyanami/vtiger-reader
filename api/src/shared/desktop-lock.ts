import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ProblemError } from './errors.js';

/** The cookie the desktop app's window carries (set by the main process, never by a page). */
export const DESKTOP_COOKIE = 'vtiger-reader-desktop';

/** This PC, as a browser names it: 127.0.0.1 or localhost, with a port. */
const LOCAL_HOST = /^(127\.0\.0\.1|localhost)(:\d{1,5})?$/i;

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/**
 * The desktop app's lock (plan 7.4). The app listens on this PC only, and only its own window may
 * use it: every request, the web build's files too, carries the launch's secret cookie (a new one at
 * every start) and names this PC as its host. Another program, or a page in a browser (which has
 * no such cookie, and with DNS rebinding a host of its own), gets a 403.
 */
export function desktopLockHook(app: FastifyInstance, token: string): void {
  const expected = Buffer.from(token, 'utf8');
  if (expected.length < 32) throw new Error('The desktop lock needs a token of at least 32 characters');
  app.addHook('onRequest', async (request) => {
    const given = Buffer.from(cookieValue(request.headers.cookie, DESKTOP_COOKIE) ?? '', 'utf8');
    const fromThisPc = LOCAL_HOST.test(request.headers.host ?? '');
    const fromTheWindow = given.length === expected.length && timingSafeEqual(given, expected);
    if (!fromThisPc || !fromTheWindow) {
      throw new ProblemError(403, 'forbidden', 'Only the vtiger-reader window can use this address');
    }
  });
}
