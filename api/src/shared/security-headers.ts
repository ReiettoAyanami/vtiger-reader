import type { FastifyInstance } from 'fastify';

/**
 * What every answer tells the browser (design-accounts.md, "security headers"; lenzi, 2026-10-03:
 * "si"). The app's pages run scripts only from the instance itself; styles and fonts may also come
 * from Google Fonts (index.html), and styles may be inline because Angular adds its components'
 * own <style> elements. No other site may show the app inside its pages. The production build keeps
 * no inline script for this: angular.json turns off the critical-CSS inlining, whose `onload`
 * handler this policy would block, leaving the app without its styles.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/** One year: after a visit over https, the browser asks only over https for that long. */
const HSTS_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** The headers, for the address the instance is opened at (APP_URL). */
export function securityHeaders(appUrl: string): Record<string, string> {
  return {
    'content-security-policy': CONTENT_SECURITY_POLICY,
    // The same as frame-ancestors, for the browsers that know only this one.
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    // Other sites never see the app's addresses: they carry the username.
    'referrer-policy': 'same-origin',
    // Only for an instance opened over https: over http a browser ignores it.
    ...(appUrl.startsWith('https://') ? { 'strict-transport-security': `max-age=${HSTS_MAX_AGE_SECONDS}` } : {}),
  };
}

/** On every answer: the app's files, the API's answers and its errors. Before any route. */
export function securityHeadersHook(app: FastifyInstance, appUrl: string): void {
  const headers = securityHeaders(appUrl);
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.headers(headers);
    return payload;
  });
}
