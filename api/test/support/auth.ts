import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { loadConfig } from '../../src/config.js';

const auth = loadConfig().auth;

/** The app's own address in the tests (APP_URL, from the environment): the only trusted origin. */
export const ORIGIN = auth.appUrl;
export const SESSION_COOKIE = `${auth.cookiePrefix}.session_token`;
/** Where Better Auth keeps an administrator's own session while it impersonates someone. */
export const ADMIN_SESSION_COOKIE = `${auth.cookiePrefix}.admin_session`;

export interface SignIn {
  status: number;
  /** "name=value" of the session cookie, ready for a Cookie header; '' when none was set. */
  cookie: string;
  body: any;
  response: LightMyRequestResponse;
}

/** "name=value" pairs of the cookies a response sets (the last value of each name wins). */
export function cookiesOf(response: LightMyRequestResponse): Map<string, string> {
  const jar = new Map<string, string>();
  for (const c of response.cookies) jar.set(c.name, c.value);
  return jar;
}

export function cookieHeader(response: LightMyRequestResponse, ...names: string[]): string {
  const jar = cookiesOf(response);
  return names
    .map((name) => (jar.get(name) ? `${name}=${jar.get(name)}` : ''))
    .filter(Boolean)
    .join('; ');
}

/** POST /api/auth/sign-in/username as the web app sends it. */
export async function signIn(
  app: FastifyInstance,
  username: string,
  password: string,
  headers: Record<string, string> = {},
): Promise<SignIn> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/username',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    payload: JSON.stringify({ username, password }),
  });
  const type = String(response.headers['content-type'] ?? '');
  return {
    status: response.statusCode,
    cookie: cookieHeader(response, SESSION_COOKIE),
    body: type.includes('json') ? response.json() : response.body,
    response,
  };
}
