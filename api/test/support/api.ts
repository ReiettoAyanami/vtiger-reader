import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { Clock } from '../../src/shared/time.js';
import type { FakeCrm } from './fake-crm.js';
import { FakePush } from './fake-push.js';
import { testPool } from './db.js';

/** Fixed "now" for the tests: 2026-09-29 12:00 in Rome. */
export const NOW = new Date('2026-09-29T10:00:00Z');
export const fixedClock: Clock = () => new Date(NOW.getTime());

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

/** Thin HTTP client over app.inject(), for the app's one profile (plan 7.1). */
export class Api {
  constructor(readonly app: FastifyInstance) {}

  async req<T = any>(method: Method, url: string, payload?: unknown): Promise<Res<T>> {
    const res = await this.app.inject({
      method,
      url,
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

  /**
   * Opens a server-sent events stream and reads up to the end of the event that has `until` (or
   * for 2 s): the status, and the text read. The stream stays open until the app closes; `more`
   * reads the next event.
   */
  async stream(url: string, until: string): Promise<Res<string> & { more: () => Promise<string> }> {
    const res = await this.app.inject({ method: 'GET', url, payloadAsStream: true });
    const stream = res.stream();
    let text = '';
    stream.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
    /** The text from `from` to the end of the first event after `needle`, once it has come. */
    const upToEvent = async (from: number, needle = '') => {
      const end = () => {
        const at = text.indexOf(needle, from);
        const close = at < 0 ? -1 : text.indexOf('\n\n', at + needle.length);
        return close < 0 ? -1 : close + 2;
      };
      for (let waited = 0; waited < 2000 && end() < 0; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
      return end() < 0 ? text.length : end();
    };
    const type = String(res.headers['content-type'] ?? '');
    let read = type.includes('event-stream') ? await upToEvent(0, until) : 0;
    if (!type.includes('event-stream')) {
      for (let waited = 0; waited < 2000 && !stream.readableEnded; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
      read = text.length;
    }
    const body = text.slice(0, read);
    return {
      status: res.statusCode,
      body: (type.includes('json') ? JSON.parse(body) : body) as string,
      headers: res.headers,
      more: async () => {
        const end = await upToEvent(read);
        const next = text.slice(read, end);
        read = end;
        return next;
      },
    };
  }

  /** POST that must succeed with 201; returns the body. */
  async created(url: string, payload: unknown): Promise<any> {
    const res = await this.post(url, payload);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  }
}

export async function makeApi(
  opts: {
    clock?: Clock;
    webDist?: string;
    crm?: FakeCrm;
    encryptionKey?: Buffer;
    hostAllowed?: (host: string) => Promise<boolean>;
    /** Fake AI providers (support/fake-ai.ts), and the hosts AI_PRIVATE_HOSTS would list. */
    ai?: { fetch: typeof fetch; privateHosts?: string[] };
    /** A fake push service (support/fake-push.ts); a new one, unread, when omitted. */
    push?: FakePush;
  } = {},
): Promise<Api> {
  // The CRM is a fake one (its made-up host allowed), or no network at all: a test never calls a
  // real address.
  const fetch: typeof globalThis.fetch = opts.crm?.fetch ?? (async () => Promise.reject(new TypeError('no network in tests')));
  const crm = { fetch, hostAllowed: opts.hostAllowed ?? (async () => true) };
  const app = await buildApp({
    pool: testPool(),
    clock: opts.clock ?? fixedClock,
    webDist: opts.webDist,
    crm: { ...crm, ...(opts.encryptionKey ? { encryptionKey: opts.encryptionKey } : {}) },
    push: { send: (opts.push ?? new FakePush()).send, hostAllowed: opts.hostAllowed ?? (async () => true) },
    ai: {
      fetch: opts.ai?.fetch ?? (async () => Promise.reject(new TypeError('no network in tests'))),
      hostAllowed: opts.hostAllowed ?? (async () => true),
      privateHosts: opts.ai?.privateHosts ?? [],
    },
  });
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
