import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PROBLEM_CONTENT_TYPE, ProblemError, problemBody, statusTitle } from '../../shared/errors.js';
import { CLIENT_IP_HEADER } from './auth.js';
import { toHeaders } from './hook.js';
import type { Identity } from './identity.js';
import type { SignInThrottle } from './throttle.js';

/**
 * The auth endpoints the app uses, answered by Better Auth (design-accounts.md, "Identity as built
 * (1.1)"). Only these: its other endpoints, `/admin/*` above all, would let a client skip the API's
 * rules, and the API's own routes call it from the server instead. Every request that changes
 * something must be JSON and must not come from another site: Better Auth checks the origin only
 * when a cookie is present, so a sign-in from another site would pass (login CSRF). An `Origin`
 * equal to the instance's address passes, and so does none at all: the Android app's native requests
 * carry none (design-android.md, "native requests"), while a browser always sends it on a POST, so a
 * request from another site is still refused. The request handed to Better Auth then carries the
 * instance's address as its `Origin`, so the library's own check sees what it sees from the website.
 * A sign-in waits first what the wrong passwords in a row of its username ask for (throttle.ts).
 */

const SIGN_IN = '/sign-in/username';
const STOP_IMPERSONATING = '/admin/stop-impersonating';
const REVOKE_OTHER_SESSIONS = '/revoke-other-sessions';

const FORWARDED: ReadonlyArray<{ method: 'GET' | 'POST'; path: string }> = [
  { method: 'POST', path: SIGN_IN },
  { method: 'POST', path: '/sign-out' },
  { method: 'GET', path: '/get-session' },
  { method: 'POST', path: REVOKE_OTHER_SESSIONS },
  { method: 'POST', path: STOP_IMPERSONATING },
];

/** Refused while an administrator acts as the user: an impersonation is for the data, not for their account. */
const NOT_WHILE_IMPERSONATING = new Set([REVOKE_OTHER_SESSIONS]);

function notWhileImpersonating(): ProblemError {
  return new ProblemError(403, 'impersonating', 'Not while impersonating: the account is the user’s own');
}

/** Hop-by-hop and recomputed headers, and ours, which only this file sets. */
const NOT_FORWARDED = new Set(['host', 'connection', 'keep-alive', 'content-length', 'transfer-encoding', 'upgrade', 'expect', CLIENT_IP_HEADER]);

export interface IdentityRoutesDeps {
  identity: Identity;
  /** The wait after wrong passwords in a row, per username (throttle.ts). */
  throttle: SignInThrottle;
  /** The only trusted origin (APP_URL). */
  appUrl: string;
  /** The header the instance's proxy sets to the client's IP; unset, the connection's address. */
  clientIpHeader: string | undefined;
}

/**
 * The client's IP: the last value of the proxy's header (a proxy appends the address it saw, so
 * whatever a client wrote in front of it is never used), else the connection's address.
 */
export function clientIp(request: FastifyRequest, header: string | undefined): string {
  if (header) {
    const raw = request.headers[header];
    const value = Array.isArray(raw) ? raw[raw.length - 1] : raw;
    const last = value
      ?.split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .at(-1);
    if (last) return last;
  }
  return request.ip;
}

/** The username of a sign-in, as Better Auth compares it (any case, no spaces around), or null. */
function usernameOf(body: unknown): string | null {
  const username = (body as { username?: unknown } | null)?.username;
  return typeof username === 'string' && username.trim() !== '' ? username.trim().toLowerCase() : null;
}

function isJson(contentType: string | undefined): boolean {
  return /^application\/json\s*(;|$)/i.test(contentType ?? '');
}

function toFetchRequest(request: FastifyRequest, deps: IdentityRoutesDeps): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || NOT_FORWARDED.has(name)) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  headers.set(CLIENT_IP_HEADER, clientIp(request, deps.clientIpHeader));
  // Checked by the route (missing or our own): from here on it is the instance's own request.
  if (request.method !== 'GET' && request.method !== 'HEAD') headers.set('origin', deps.appUrl);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return new Request(`${deps.appUrl}${request.url}`, {
    method: request.method,
    headers,
    ...(hasBody ? { body: JSON.stringify(request.body ?? {}) } : {}),
  });
}

async function send(reply: FastifyReply, response: Response): Promise<FastifyReply> {
  reply.code(response.status);
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) reply.header('set-cookie', cookies);
  const retryAfter = response.headers.get('x-retry-after');
  if (retryAfter) reply.header('retry-after', retryAfter);
  const text = await response.text();
  if (response.status >= 400) {
    let parsed: { code?: unknown; message?: unknown } = {};
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      // not JSON: the status says enough
    }
    const code =
      typeof parsed.code === 'string'
        ? parsed.code.toLowerCase().replace(/_/g, '-')
        : response.status === 429
          ? 'too-many-requests'
          : null;
    const detail = typeof parsed.message === 'string' ? parsed.message : statusTitle(response.status);
    return reply.type(PROBLEM_CONTENT_TYPE).send(problemBody(response.status, code, detail));
  }
  reply.type(response.headers.get('content-type') ?? 'application/json; charset=utf-8');
  return reply.send(withoutTokens(text));
}

/**
 * Better Auth also puts the session token in the bodies (sign-in, the session): the cookie carries
 * it, HttpOnly so that no script reads it, and the web app never needs it. Out of every body.
 */
function withoutTokens(text: string): string {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return text;
  }
  if (body === null || typeof body !== 'object') return text;
  const record = body as { token?: unknown; session?: { token?: unknown } | null };
  delete record.token;
  if (record.session && typeof record.session === 'object') delete record.session.token;
  return JSON.stringify(record);
}

export function identityRoutes(app: FastifyInstance, deps: IdentityRoutesDeps): void {
  for (const { method, path } of FORWARDED) {
    app.route({
      method,
      url: `/api/auth${path}`,
      handler: async (request, reply) => {
        if (method !== 'GET') {
          const origin = request.headers.origin;
          if (origin !== undefined && origin !== deps.appUrl) {
            throw new ProblemError(403, 'origin', 'This request must come from the app itself');
          }
          if (!isJson(request.headers['content-type'])) {
            throw new ProblemError(415, 'media-type', 'The body must be JSON');
          }
        }
        const fetchRequest = toFetchRequest(request, deps);
        const asker =
          path === STOP_IMPERSONATING || NOT_WHILE_IMPERSONATING.has(path) ? await deps.identity.userOf(fetchRequest.headers) : null;
        if (asker?.impersonatedBy && NOT_WHILE_IMPERSONATING.has(path)) throw notWhileImpersonating();
        const username = path === SIGN_IN ? usernameOf(request.body) : null;
        if (username) await deps.throttle.beforeAttempt(username);
        const response = await deps.identity.handle(fetchRequest);
        // 401 is a wrong username or password, 200 a right one; nothing else counts (429, 422, 403).
        if (username && (response.status === 401 || response.status === 200)) {
          await deps.throttle.afterAttempt(username, response.status === 200);
        }
        // The end of an impersonation goes to the log, like its start (design-accounts.md).
        if (path === STOP_IMPERSONATING && asker?.impersonatedBy && response.status === 200) {
          request.log.info(
            { impersonation: { by: asker.impersonatedBy, as: asker.userId, username: asker.username } },
            'impersonation ended',
          );
        }
        return send(reply, response);
      },
    });
  }
}

const changePasswordSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['currentPassword', 'newPassword'],
    // Generous bounds: the rules (passwordProblem) give the reasons.
    properties: {
      currentPassword: { type: 'string', minLength: 1, maxLength: 512 },
      newPassword: { type: 'string', minLength: 1, maxLength: 512 },
    },
  },
} as const;

interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

/**
 * The signed-in user's own account (design-accounts.md, "Web: /<username>/settings"): a new
 * password, giving the current one (204; the session in use stays, the others close). Never while
 * an administrator acts as the user. Signing out of the other devices is Better Auth's own
 * `/api/auth/revoke-other-sessions`, forwarded above.
 */
export function accountRoutes(app: FastifyInstance, deps: { identity: Identity }): void {
  app.post<{ Body: ChangePasswordBody }>('/api/account/password', { schema: changePasswordSchema }, async (req, reply) => {
    if (req.user?.impersonatedBy) throw notWhileImpersonating();
    await deps.identity.changeOwnPassword(toHeaders(req.headers), req.body.currentPassword, req.body.newPassword);
    return reply.code(204).send();
  });
}
