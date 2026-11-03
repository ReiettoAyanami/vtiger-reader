import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { Clock } from '../../src/shared/time.js';
import { testPool } from './db.js';
import { TESTER, cookieOf, type TestUser } from './session.js';

/** Fixed "now" for the tests: 2026-09-29 12:00 in Rome. */
export const NOW = new Date('2026-09-29T10:00:00Z');
export const fixedClock: Clock = () => new Date(NOW.getTime());

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

/**
 * Thin HTTP client over app.inject(), plus helpers to build a ledger quickly. It works as a signed-in
 * user (the tester unless told otherwise, see session.ts), or signed out with `as(null)`.
 */
export class Api {
  constructor(
    readonly app: FastifyInstance,
    readonly user: TestUser | null = TESTER,
  ) {}

  /** The same app as another user, or signed out (null). */
  as(user: TestUser | null): Api {
    return new Api(this.app, user);
  }

  async req<T = any>(method: Method, url: string, payload?: unknown): Promise<Res<T>> {
    const cookie = this.user ? await cookieOf(this.app, this.user) : null;
    const res = await this.app.inject({
      method,
      url,
      ...(cookie ? { headers: { cookie } } : {}),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
    const type = String(res.headers['content-type'] ?? '');
    const body = res.body && type.includes('json') ? res.json() : res.body;
    return { status: res.statusCode, body: body as T, headers: res.headers };
  }

  get<T = any>(url: string) {
    return this.req<T>('GET', url);
  }
  post<T = any>(url: string, payload: unknown = {}) {
    return this.req<T>('POST', url, payload);
  }
  put<T = any>(url: string, payload: unknown) {
    return this.req<T>('PUT', url, payload);
  }
  patch<T = any>(url: string, payload: unknown) {
    return this.req<T>('PATCH', url, payload);
  }
  del<T = any>(url: string) {
    return this.req<T>('DELETE', url);
  }

  /** POST that must succeed with 201; returns the body. */
  async created(url: string, payload: unknown): Promise<any> {
    const res = await this.post(url, payload);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  }
}

export async function makeApi(opts: { clock?: Clock; webDist?: string } = {}): Promise<Api> {
  // The sign-in counters are tested on their own (identity/routes.test.ts).
  const app = await buildApp({ pool: testPool(), clock: opts.clock ?? fixedClock, webDist: opts.webDist, auth: { rateLimit: false } });
  await app.ready();
  return new Api(app);
}

/** Asserts a Problem Details response. */
export function expectProblem(res: Res, status: number, code?: string): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(String(res.headers['content-type'])).toContain('application/problem+json');
  expect(res.body.status).toBe(status);
  expect(typeof res.body.title).toBe('string');
  expect(typeof res.body.detail).toBe('string');
  expect(Array.isArray(res.body.errors)).toBe(true);
  if (code) expect(res.body.type).toBe(`urn:vtiger-reader:problem:${code}`);
}
