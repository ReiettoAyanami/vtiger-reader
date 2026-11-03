import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectProblem, makeApi, type Api, type Res } from '../support/api.js';
import { ADMIN_SESSION_COOKIE, ORIGIN, SESSION_COOKIE, cookieHeader, signIn } from '../support/auth.js';
import { rawRows } from '../support/db.js';
import { OTHER, TESTER, cookieOf, idOf, type TestUser } from '../support/session.js';

const BOSS: TestUser = { username: 'boss', password: 'Boss-pass-000001', role: 'admin' };

let api: Api;
beforeAll(async () => {
  api = await makeApi();
});
afterAll(async () => {
  await api.app.close();
});

async function call(app: FastifyInstance, method: 'GET' | 'POST', url: string, cookie: string, payload?: unknown): Promise<Res> {
  const res = await app.inject({
    method,
    url,
    headers: { cookie, ...(payload === undefined ? {} : { origin: ORIGIN, 'content-type': 'application/json' }) },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
  const type = String(res.headers['content-type'] ?? '');
  return { status: res.statusCode, body: res.body && type.includes('json') ? res.json() : res.body, headers: res.headers };
}

const changePassword = (cookie: string, currentPassword: string, newPassword: string) =>
  call(api.app, 'POST', '/api/account/password', cookie, { currentPassword, newPassword });

describe("changing one's own password", () => {
  it('with the current one: the new one works, the session in use stays, the other devices are signed out', async () => {
    const here = await cookieOf(api.app, TESTER);
    const elsewhere = (await signIn(api.app, 'tester', TESTER.password)).cookie;

    const res = await changePassword(here, TESTER.password, 'Tester-pass-0002');
    expect(res.status, JSON.stringify(res.body)).toBe(204);

    expect((await call(api.app, 'GET', '/api/settings', here)).status).toBe(200);
    expectProblem(await call(api.app, 'GET', '/api/settings', elsewhere), 401, 'unauthenticated');
    expect((await signIn(api.app, 'tester', TESTER.password)).status).toBe(401);
    expect((await signIn(api.app, 'tester', 'Tester-pass-0002')).status).toBe(200);
    expect(await rawRows('SELECT COUNT(*) AS n FROM password_history WHERE user_id = ?', [await idOf(api.app, TESTER)])).toEqual([{ n: 1 }]);
  });

  it('a wrong current password: 400 under its field (never 401: the session is fine), nothing changed', async () => {
    const here = await cookieOf(api.app, TESTER);
    const res = await changePassword(here, 'not-my-password-1!', 'Tester-pass-0002');
    expectProblem(res, 400, 'wrong-password');
    expect(res.body.errors).toEqual([{ field: 'currentPassword', message: 'This is not your current password' }]);
    expect((await call(api.app, 'GET', '/api/settings', here)).status).toBe(200);
    expect((await signIn(api.app, 'tester', TESTER.password)).status).toBe(200);
  });

  it('the new one: the rules, and never a password the user had, under its field', async () => {
    const here = await cookieOf(api.app, TESTER);
    const fieldOf = (res: Res) => res.body.errors.map((e: { field: string }) => e.field);

    const weak = await changePassword(here, TESTER.password, 'short');
    expectProblem(weak, 400, 'validation');
    expect(fieldOf(weak)).toEqual(['newPassword']);
    const same = await changePassword(here, TESTER.password, TESTER.password);
    expectProblem(same, 409, 'password-used-before');
    expect(fieldOf(same)).toEqual(['newPassword']);

    expect((await changePassword(here, TESTER.password, 'Tester-pass-0002')).status).toBe(204);
    expectProblem(await changePassword(here, 'Tester-pass-0002', TESTER.password), 409, 'password-used-before');
  });

  it('signed out: 401, as every private route', async () => {
    expectProblem(await call(api.app, 'POST', '/api/account/password', '', { currentPassword: 'a', newPassword: 'b' }), 401, 'unauthenticated');
  });

  it("never while impersonating: neither the user's password nor their other devices", async () => {
    const testerId = await idOf(api.app, TESTER);
    const testerCookie = await cookieOf(api.app, TESTER);
    const started = await api.app.inject({
      method: 'POST',
      url: `/api/admin/users/${testerId}/impersonate`,
      headers: { cookie: await cookieOf(api.app, BOSS), 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(started.statusCode).toBe(200);
    const viewing = cookieHeader(started, SESSION_COOKIE, ADMIN_SESSION_COOKIE);

    expectProblem(await changePassword(viewing, TESTER.password, 'Tester-pass-0002'), 403, 'impersonating');
    expectProblem(await call(api.app, 'POST', '/api/auth/revoke-other-sessions', viewing, {}), 403, 'impersonating');
    // the user's own session, and password, as they were
    expect((await call(api.app, 'GET', '/api/settings', testerCookie)).status).toBe(200);
    expect((await signIn(api.app, 'tester', TESTER.password)).status).toBe(200);
  });
});

describe('signing out of the other devices', () => {
  it("ends the user's other sessions, keeps this one, and leaves the other users alone", async () => {
    const here = await cookieOf(api.app, TESTER);
    const elsewhere = (await signIn(api.app, 'tester', TESTER.password)).cookie;
    const someoneElse = await cookieOf(api.app, OTHER);

    const res = await call(api.app, 'POST', '/api/auth/revoke-other-sessions', here, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect((await call(api.app, 'GET', '/api/settings', here)).status).toBe(200);
    expectProblem(await call(api.app, 'GET', '/api/settings', elsewhere), 401, 'unauthenticated');
    expect((await call(api.app, 'GET', '/api/settings', someoneElse)).status).toBe(200);
  });
});
