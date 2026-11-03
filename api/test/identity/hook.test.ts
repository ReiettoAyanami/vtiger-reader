import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { expectProblem, fixedClock, makeApi, type Api } from '../support/api.js';
import { signIn } from '../support/auth.js';
import { rawRows, testPool } from '../support/db.js';
import { TESTER, cookieOf, idOf } from '../support/session.js';

let api: Api;
beforeAll(async () => {
  api = await makeApi();
});
afterAll(async () => {
  await api.app.close();
});

describe('every /api route needs a session', () => {
  it('without one: a 401 problem, the data untouched', async () => {
    const anonymous = api.as(null);
    expectProblem(await anonymous.get('/api/settings'), 401, 'unauthenticated');
    expectProblem(await anonymous.patch('/api/settings', { timezone: 'Asia/Tokyo' }), 401, 'unauthenticated');
    expect(await rawRows("SELECT id FROM user_settings WHERE timezone = 'Asia/Tokyo'")).toEqual([]);
  });

  it('an address that does not exist says nothing without a session (401), and 404 with one', async () => {
    expectProblem(await api.as(null).get('/api/nope'), 401, 'unauthenticated');
    expectProblem(await api.get('/api/nope'), 404, 'not-found');
  });

  it('health, version and the sign-in endpoints are public', async () => {
    const anonymous = api.as(null);
    expect((await anonymous.get('/api/health')).status).toBe(200);
    expect((await anonymous.get('/api/version')).status).toBe(200);
    const session = await anonymous.get('/api/auth/get-session');
    expect(session.status).toBe(200);
    expect(session.body).toBeNull();
  });

  it('the session is read at every request: once gone, the next request is 401', async () => {
    expect((await api.get('/api/settings')).status).toBe(200);
    await rawRows('DELETE FROM sessions WHERE user_id = ?', [await idOf(api.app, TESTER)]);
    expectProblem(await api.get('/api/settings'), 401, 'unauthenticated');
  });
});

describe('while an administrator impersonates a user', () => {
  let logs: string[];
  let logged: FastifyInstance;

  beforeAll(async () => {
    logs = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        logs.push(String(chunk));
        done();
      },
    });
    logged = await buildApp({ pool: testPool(), clock: fixedClock, logger: { level: 'info', stream }, auth: { rateLimit: false } });
    await logged.ready();
  });
  afterAll(async () => {
    await logged.close();
  });

  it('every write goes to the log: who, as whom, method, path, status; reads do not', async () => {
    const adminId = await logged.identity.createUser({ username: 'boss', email: 'boss@dev.invalid', password: 'Boss-pass-000001', role: 'admin' });
    const userId = await logged.identity.createUser({ username: 'worker', email: 'worker@dev.invalid', password: 'Worker-pass-0001', role: 'user' });
    const session = await signIn(logged, 'worker', 'Worker-pass-0001');
    const token = decodeURIComponent(session.cookie.split('=')[1] ?? '').split('.')[0];
    await rawRows('UPDATE sessions SET impersonated_by = ? WHERE token = ?', [adminId, token]);
    logs.length = 0;

    const read = await logged.inject({ method: 'GET', url: '/api/settings', headers: { cookie: session.cookie } });
    expect(read.statusCode).toBe(200);
    const write = await logged.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { cookie: session.cookie },
      payload: { timezone: 'Asia/Tokyo' },
    });
    expect(write.statusCode).toBe(200);

    const entries = logs.map((line) => JSON.parse(line) as { msg?: string; impersonation?: unknown }).filter((e) => e.impersonation);
    expect(entries).toEqual([
      expect.objectContaining({
        msg: 'write while impersonating',
        impersonation: { by: adminId, as: userId, username: 'worker', method: 'PATCH', path: '/api/settings', status: 200 },
      }),
    ]);
    // the change is the user's, not the administrator's
    expect(await rawRows("SELECT user_id FROM user_settings WHERE timezone = 'Asia/Tokyo'")).toEqual([{ user_id: userId }]);
  });

  it('nothing is logged for the user acting as themselves', async () => {
    const cookie = await cookieOf(logged, TESTER);
    logs.length = 0;
    await logged.inject({ method: 'PATCH', url: '/api/settings', headers: { cookie }, payload: { timezone: 'Asia/Tokyo' } });
    expect(logs.filter((line) => line.includes('impersonat'))).toEqual([]);
  });
});
