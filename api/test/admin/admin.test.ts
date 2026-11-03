import { Writable } from 'node:stream';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { AdminService } from '../../src/modules/admin/service.js';
import { passwordProblem } from '../../src/modules/identity/passwords.js';
import { ownerOf } from '../../src/shared/owner.js';
import { expectProblem, fixedClock, makeApi, type Api, type Res } from '../support/api.js';
import { ADMIN_SESSION_COOKIE, ORIGIN, SESSION_COOKIE, cookieHeader, signIn } from '../support/auth.js';
import { rawRows, testPool } from '../support/db.js';
import { OTHER, TESTER, cookieOf, idOf, type TestUser } from '../support/session.js';

/** Two administrators: the one acting in most tests, and another one to act on. */
const BOSS: TestUser = { username: 'boss', password: 'Boss-pass-000001', role: 'admin' };
const CHIEF: TestUser = { username: 'chief', password: 'Chief-pass-00001', role: 'admin' };

let api: Api;
let admin: Api;
beforeAll(async () => {
  api = await makeApi();
  admin = api.as(BOSS);
});
afterAll(async () => {
  await api.app.close();
});

/** Starts an impersonation as `by`; the cookies of the impersonation session and of the way back. */
async function impersonate(app: FastifyInstance, by: TestUser, userId: number): Promise<{ res: LightMyRequestResponse; cookie: string }> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/admin/users/${userId}/impersonate`,
    headers: { cookie: await cookieOf(app, by), 'content-type': 'application/json' },
    payload: '{}',
  });
  return { res, cookie: cookieHeader(res, SESSION_COOKIE, ADMIN_SESSION_COOKIE) };
}

/** A GET with a raw Cookie header. */
async function getWith(app: FastifyInstance, url: string, cookie: string): Promise<Res> {
  const res = await app.inject({ method: 'GET', url, headers: { cookie } });
  return { status: res.statusCode, body: res.body ? res.json() : res.body, headers: res.headers };
}

describe('the admin routes exist only for an administrator acting as itself', () => {
  it('for a user they answer as a route that does not exist, and do nothing', async () => {
    const routes: Array<[string, (as: Api) => Promise<Res>]> = [
      ['GET /api/admin/users', (as) => as.get('/api/admin/users')],
      ['POST /api/admin/users', (as) => as.post('/api/admin/users', { username: 'sneaky', email: 's@dev.invalid', password: 'Sneaky-pass-0001', role: 'admin' })],
      ['PATCH /api/admin/users/1', (as) => as.patch('/api/admin/users/1', { role: 'admin' })],
      ['DELETE /api/admin/users/1', (as) => as.del('/api/admin/users/1')],
      ['POST /api/admin/users/1/impersonate', (as) => as.post('/api/admin/users/1/impersonate')],
      ['GET /api/admin/generated-password', (as) => as.get('/api/admin/generated-password')],
    ];
    await idOf(api.app, BOSS);
    for (const [route, call] of routes) {
      const res = await call(api);
      expectProblem(res, 404, 'not-found');
      expect(res.body.detail, route).toBe(`No route for ${route.replace(/ \/api.*/, '')} ${route.replace(/^\S+ /, '')}`);
      // signed out, nothing at all
      expectProblem(await call(api.as(null)), 401, 'unauthenticated');
    }
    expect(await rawRows('SELECT username, role FROM users ORDER BY id')).toEqual([
      { username: 'boss', role: 'admin' },
      { username: 'tester', role: 'user' },
    ]);
  });

  it("while impersonating, even another administrator's session finds none of them", async () => {
    const { cookie } = await impersonate(api.app, BOSS, await idOf(api.app, CHIEF));
    expectProblem(await getWith(api.app, '/api/admin/users', cookie), 404, 'not-found');
    // the personal instance of the administrator, yes
    expect((await getWith(api.app, '/api/settings', cookie)).status).toBe(200);
  });
});

describe('the list of users', () => {
  it('every user by username: email, role, blocked, with a password or not, created', async () => {
    await idOf(api.app, BOSS);
    const testerId = await idOf(api.app, TESTER);
    await api.app.identity.createUser({ username: 'test-user', email: 'test-user@dev.invalid', password: null, role: 'user' });
    expect((await admin.patch(`/api/admin/users/${testerId}`, { blocked: true })).status).toBe(200);

    const res = await admin.get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.map((u: { createdAt: string }) => ({ ...u, createdAt: typeof u.createdAt }))).toEqual([
      { id: 1, username: 'boss', email: 'boss@test.invalid', role: 'admin', blocked: false, hasPassword: true, createdAt: 'string' },
      { id: 3, username: 'test-user', email: 'test-user@dev.invalid', role: 'user', blocked: false, hasPassword: false, createdAt: 'string' },
      { id: 2, username: 'tester', email: 'tester@test.invalid', role: 'user', blocked: true, hasPassword: true, createdAt: 'string' },
    ]);
    // an instant in UTC, written like every other one of the API
    expect(res.body[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe('creating a user', () => {
  it('ready to use: its credentials, the settings of the administrator who creates it', async () => {
    expect((await admin.patch('/api/settings', { timezone: 'Europe/London' })).status).toBe(200);

    const res = await admin.post('/api/admin/users', { username: 'Friend', email: ' Friend@Dev.Invalid ', password: 'Friend-pass-0001', role: 'user' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(Number),
      username: 'friend',
      email: 'friend@dev.invalid',
      role: 'user',
      blocked: false,
      hasPassword: true,
      createdAt: expect.any(String),
    });

    const friend = await signIn(api.app, 'friend', 'Friend-pass-0001');
    expect(friend.status).toBe(200);
    expect((await getWith(api.app, '/api/settings', friend.cookie)).body).toEqual({ language: 'en', timezone: 'Europe/London' });
  });

  it('another administrator, who then reaches the admin routes', async () => {
    const res = await admin.post('/api/admin/users', { username: 'second', email: 'second@dev.invalid', password: 'Second-pass-0001', role: 'admin' });
    expect(res.status).toBe(201);
    const second = await signIn(api.app, 'second', 'Second-pass-0001');
    expect((await getWith(api.app, '/api/admin/users', second.cookie)).status).toBe(200);
  });

  it('the rules, each under its field', async () => {
    const user = { username: 'friend', email: 'friend@dev.invalid', password: 'Friend-pass-0001', role: 'user' };
    const fieldOf = (res: Res) => res.body.errors.map((e: { field: string }) => e.field);

    for (const [change, field] of [
      [{ username: 'login' }, 'username'], // a reserved word
      [{ username: 'a.b' }, 'username'],
      [{ email: 'not-an-email' }, 'email'],
      [{ password: 'Short-1!' }, 'password'],
      [{ password: 'no-digit-in-here!' }, 'password'],
      [{ password: 'NoSpecial0000000' }, 'password'],
    ] as const) {
      const res = await admin.post('/api/admin/users', { ...user, ...change });
      expectProblem(res, 400, 'validation');
      expect(fieldOf(res), JSON.stringify(change)).toEqual([field]);
    }
    expect((await admin.post('/api/admin/users', user)).status).toBe(201);
    const takenName = await admin.post('/api/admin/users', { ...user, email: 'other@dev.invalid' });
    expectProblem(takenName, 409, 'username-taken');
    expect(fieldOf(takenName)).toEqual(['username']);
    const takenEmail = await admin.post('/api/admin/users', { ...user, username: 'friend2', email: 'FRIEND@dev.invalid' });
    expectProblem(takenEmail, 409, 'email-taken');
    expect(fieldOf(takenEmail)).toEqual(['email']);
    expectProblem(await admin.post('/api/admin/users', { ...user, username: 'friend3', email: 'f3@dev.invalid', role: 'root' }), 400, 'validation');
    expectProblem(await admin.post('/api/admin/users', { ...user, username: 'friend4', email: 'f4@dev.invalid', banned: true }), 400, 'validation');
    expect(await rawRows("SELECT username FROM users WHERE username LIKE 'friend%'")).toEqual([{ username: 'friend' }]);
  });
});

describe('changing a user', () => {
  it('email and role: an administrator made, and unmade', async () => {
    const id = await idOf(api.app, TESTER);
    expect((await admin.patch(`/api/admin/users/${id}`, { email: 'New@Dev.Invalid' })).body).toMatchObject({ email: 'new@dev.invalid' });

    expect((await admin.patch(`/api/admin/users/${id}`, { role: 'admin' })).body).toMatchObject({ role: 'admin' });
    expect((await api.get('/api/admin/users')).status).toBe(200);
    expect((await admin.patch(`/api/admin/users/${id}`, { role: 'user' })).body).toMatchObject({ role: 'user' });
    expectProblem(await api.get('/api/admin/users'), 404, 'not-found');
  });

  it("an email must be well formed and nobody else's", async () => {
    const id = await idOf(api.app, TESTER);
    await idOf(api.app, OTHER);
    expectProblem(await admin.patch(`/api/admin/users/${id}`, { email: 'nope' }), 400, 'validation');
    const taken = await admin.patch(`/api/admin/users/${id}`, { email: 'Other-User@test.invalid' });
    expectProblem(taken, 409, 'email-taken');
    expect(taken.body.errors).toEqual([{ field: 'email', message: expect.any(String) }]);
    // its own email again is no change, not a conflict
    expect((await admin.patch(`/api/admin/users/${id}`, { email: 'tester@test.invalid' })).status).toBe(200);
  });

  it('a password reset: the rules, never one the user had, and its sessions closed', async () => {
    const id = await idOf(api.app, TESTER);
    const before = await cookieOf(api.app, TESTER);

    expectProblem(await admin.patch(`/api/admin/users/${id}`, { password: 'short' }), 400, 'validation');
    const current = await admin.patch(`/api/admin/users/${id}`, { password: TESTER.password });
    expectProblem(current, 409, 'password-used-before');
    expect(current.body.errors).toEqual([{ field: 'password', message: expect.any(String) }]);
    expect((await getWith(api.app, '/api/settings', before)).status).toBe(200); // nothing changed

    expect((await admin.patch(`/api/admin/users/${id}`, { password: 'Tester-pass-0002' })).status).toBe(200);
    expectProblem(await getWith(api.app, '/api/settings', before), 401, 'unauthenticated');
    expect((await signIn(api.app, 'tester', TESTER.password)).status).toBe(401);
    expect((await signIn(api.app, 'tester', 'Tester-pass-0002')).status).toBe(200);
    // the earlier one is still refused
    expectProblem(await admin.patch(`/api/admin/users/${id}`, { password: TESTER.password }), 409, 'password-used-before');
  });

  it('a user without a password (test-user) gets one, and can sign in', async () => {
    const id = await api.app.identity.createUser({ username: 'test-user', email: 'test-user@dev.invalid', password: null, role: 'user' });
    const res = await admin.patch(`/api/admin/users/${id}`, { password: 'Test-user-pass-01' });
    expect(res.body).toMatchObject({ hasPassword: true });
    expect((await signIn(api.app, 'test-user', 'Test-user-pass-01')).status).toBe(200);
  });

  it('block: out at once and kept out; unblock lets the user in again, the data untouched', async () => {
    const id = await idOf(api.app, TESTER);
    await api.patch('/api/settings', { timezone: 'Asia/Tokyo' });
    const cookie = await cookieOf(api.app, TESTER);

    expect((await admin.patch(`/api/admin/users/${id}`, { blocked: true })).body).toMatchObject({ blocked: true });
    expectProblem(await getWith(api.app, '/api/settings', cookie), 401, 'unauthenticated');
    const refused = await signIn(api.app, 'tester', TESTER.password);
    expect(refused.status).toBe(403);
    expect(refused.body.type).toBe('urn:vtiger-reader:problem:banned-user');

    expect((await admin.patch(`/api/admin/users/${id}`, { blocked: false })).body).toMatchObject({ blocked: false });
    const back = await signIn(api.app, 'tester', TESTER.password);
    expect(back.status).toBe(200);
    expect((await getWith(api.app, '/api/settings', back.cookie)).body).toMatchObject({ timezone: 'Asia/Tokyo' });
  });

  it('everything is checked before anything changes', async () => {
    const id = await idOf(api.app, TESTER);
    expectProblem(await admin.patch(`/api/admin/users/${id}`, { email: 'fresh@dev.invalid', role: 'admin', password: TESTER.password }), 409);
    expect(await rawRows('SELECT email, role FROM users WHERE id = ?', [id])).toEqual([{ email: 'tester@test.invalid', role: 'user' }]);
  });

  it('administrators act on other administrators: password, block, role', async () => {
    const id = await idOf(api.app, CHIEF);
    expect((await admin.patch(`/api/admin/users/${id}`, { password: 'Chief-pass-00002' })).status).toBe(200);
    expect((await admin.patch(`/api/admin/users/${id}`, { blocked: true })).body).toMatchObject({ blocked: true });
    expect((await admin.patch(`/api/admin/users/${id}`, { blocked: false, role: 'user' })).body).toMatchObject({ blocked: false, role: 'user' });
  });

  it('an administrator blocked or made a user loses the impersonations it has open', async () => {
    const chiefId = await idOf(api.app, CHIEF);
    const testerId = await idOf(api.app, TESTER);
    const first = await impersonate(api.app, CHIEF, testerId);
    expect((await getWith(api.app, '/api/settings', first.cookie)).status).toBe(200);
    expect((await admin.patch(`/api/admin/users/${chiefId}`, { role: 'user' })).status).toBe(200);
    expectProblem(await getWith(api.app, '/api/settings', first.cookie), 401, 'unauthenticated');

    expect((await admin.patch(`/api/admin/users/${chiefId}`, { role: 'admin' })).status).toBe(200);
    const chief = await signIn(api.app, 'chief', CHIEF.password);
    const second = await api.app.inject({
      method: 'POST',
      url: `/api/admin/users/${testerId}/impersonate`,
      headers: { cookie: chief.cookie, 'content-type': 'application/json' },
      payload: '{}',
    });
    const secondCookie = cookieHeader(second, SESSION_COOKIE, ADMIN_SESSION_COOKIE);
    expect((await getWith(api.app, '/api/settings', secondCookie)).status).toBe(200);
    expect((await admin.patch(`/api/admin/users/${chiefId}`, { blocked: true })).status).toBe(200);
    expectProblem(await getWith(api.app, '/api/settings', secondCookie), 401, 'unauthenticated');
    // the user's own session is the user's: untouched
    expect((await api.get('/api/settings')).status).toBe(200);
  });
});

describe('the rules over every change', () => {
  it('an administrator never acts on itself', async () => {
    const id = await idOf(api.app, BOSS);
    expectProblem(await admin.patch(`/api/admin/users/${id}`, { role: 'user' }), 409, 'not-on-self');
    expectProblem(await admin.patch(`/api/admin/users/${id}`, { password: 'Boss-pass-000002' }), 409, 'not-on-self');
    expectProblem(await admin.del(`/api/admin/users/${id}`), 409, 'not-on-self');
    expectProblem(await admin.post(`/api/admin/users/${id}/impersonate`), 409, 'not-on-self');
    expect(await rawRows('SELECT role, banned FROM users WHERE id = ?', [id])).toEqual([{ role: 'admin', banned: 0 }]);
  });

  it('a user that does not exist: 404', async () => {
    await idOf(api.app, BOSS);
    expectProblem(await admin.patch('/api/admin/users/999', { role: 'admin' }), 404, 'not-found');
    expectProblem(await admin.del('/api/admin/users/999'), 404, 'not-found');
    expectProblem(await admin.post('/api/admin/users/999/impersonate'), 404, 'not-found');
  });

  it('there is always an administrator who can sign in', async () => {
    // Over HTTP the acting administrator is one; the rule holds for any caller of the service.
    const chiefId = await idOf(api.app, CHIEF);
    const service = new AdminService(api.app.identity, api.app.accounts);
    const nobody = { user: { userId: 999, username: 'ghost', role: 'admin' as const, impersonatedBy: null }, owner: ownerOf(999) };

    await expect(service.update(nobody, chiefId, { role: 'user' })).rejects.toMatchObject({ status: 409, code: 'last-administrator' });
    await expect(service.update(nobody, chiefId, { blocked: true })).rejects.toMatchObject({ status: 409, code: 'last-administrator' });
    await expect(service.remove(nobody, chiefId)).rejects.toMatchObject({ status: 409, code: 'last-administrator' });
    // a second one who can sign in: then it can go
    await idOf(api.app, BOSS);
    expect((await service.update(nobody, chiefId, { blocked: true })).blocked).toBe(true);
  });
});

describe('deleting a user', () => {
  it('everything of theirs goes in one transaction; nothing of anyone else', async () => {
    const testerId = await idOf(api.app, TESTER);
    await api.patch('/api/settings', { timezone: 'Asia/Tokyo' });
    await api.as(OTHER).patch('/api/settings', { timezone: 'America/Lima' });
    expect((await admin.patch(`/api/admin/users/${testerId}`, { password: 'Tester-pass-0002' })).status).toBe(200); // a password history
    const testerCookie = (await signIn(api.app, 'tester', 'Tester-pass-0002')).cookie;

    const res = await admin.del(`/api/admin/users/${testerId}`);
    expect(res.status, JSON.stringify(res.body)).toBe(204);

    const left = async (sql: string) => Number((await rawRows(sql, [testerId]))[0]?.n);
    for (const table of ['user_settings', 'password_history', 'sessions', 'accounts']) {
      expect(await left(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`), table).toBe(0);
    }
    expect(await rawRows('SELECT username FROM users ORDER BY id')).toEqual([{ username: 'other-user' }, { username: 'boss' }]);
    expectProblem(await getWith(api.app, '/api/settings', testerCookie), 401, 'unauthenticated');
    // the other user's settings, as they were
    expect((await api.as(OTHER).get('/api/settings')).body).toMatchObject({ timezone: 'America/Lima' });
    expect((await admin.get('/api/admin/users')).body.map((u: { username: string }) => u.username)).toEqual(['boss', 'other-user']);
  });

  it('an administrator deleted while impersonating: the impersonation ends with it', async () => {
    const chiefId = await idOf(api.app, CHIEF);
    const { cookie } = await impersonate(api.app, CHIEF, await idOf(api.app, TESTER));
    expect((await admin.del(`/api/admin/users/${chiefId}`)).status).toBe(204);
    expectProblem(await getWith(api.app, '/api/settings', cookie), 401, 'unauthenticated');
    expect((await api.get('/api/settings')).status).toBe(200);
  });
});

describe('impersonating a user', () => {
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

  const entries = () =>
    logs.map((line) => JSON.parse(line) as { msg?: string; impersonation?: unknown }).filter((e) => e.impersonation);

  it("the administrator works in the user's app, logged; Exit gives the administrator its own session back", async () => {
    const bossId = await idOf(logged, BOSS);
    const testerId = await idOf(logged, TESTER);
    const testerCookie = await cookieOf(logged, TESTER);
    await logged.inject({ method: 'PATCH', url: '/api/settings', headers: { cookie: testerCookie }, payload: { timezone: 'Asia/Tokyo' } });
    logs.length = 0;

    const { res, cookie } = await impersonate(logged, BOSS, testerId);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().user).toMatchObject({ id: testerId, username: 'tester' });
    expect(cookie).toContain(ADMIN_SESSION_COOKIE);
    expect((await getWith(logged, '/api/settings', cookie)).body).toMatchObject({ timezone: 'Asia/Tokyo' });
    const write = await logged.inject({ method: 'PATCH', url: '/api/settings', headers: { cookie }, payload: { timezone: 'Europe/Paris' } });
    expect(write.statusCode).toBe(200);
    expect(await rawRows('SELECT user_id, timezone FROM user_settings WHERE timezone = ?', ['Europe/Paris'])).toEqual([{ user_id: testerId, timezone: 'Europe/Paris' }]);
    expectProblem(await getWith(logged, '/api/admin/users', cookie), 404, 'not-found');

    const exit = await logged.inject({
      method: 'POST',
      url: '/api/auth/admin/stop-impersonating',
      headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(exit.statusCode, exit.body).toBe(200);
    const back = cookieHeader(exit, SESSION_COOKIE);
    expect((await getWith(logged, '/api/admin/users', back)).status).toBe(200);
    expectProblem(await getWith(logged, '/api/settings', cookie.split('; ')[0] ?? ''), 401, 'unauthenticated');

    expect(entries()).toEqual([
      expect.objectContaining({ msg: 'impersonation started', impersonation: { by: bossId, as: testerId, username: 'tester' } }),
      expect.objectContaining({
        msg: 'write while impersonating',
        impersonation: { by: bossId, as: testerId, username: 'tester', method: 'PATCH', path: '/api/settings', status: 200 },
      }),
      expect.objectContaining({ msg: 'impersonation ended', impersonation: { by: bossId, as: testerId, username: 'tester' } }),
    ]);
  });

  it('another administrator can be impersonated: its personal instance, not its powers', async () => {
    const { res, cookie } = await impersonate(logged, BOSS, await idOf(logged, CHIEF));
    expect(res.statusCode).toBe(200);
    expect((await getWith(logged, '/api/settings', cookie)).status).toBe(200);
    expectProblem(await getWith(logged, '/api/admin/users', cookie), 404, 'not-found');
  });

  it('a blocked user cannot be impersonated: unblock first', async () => {
    const testerId = await idOf(logged, TESTER);
    const block = await logged.inject({
      method: 'PATCH',
      url: `/api/admin/users/${testerId}`,
      headers: { cookie: await cookieOf(logged, BOSS) },
      payload: { blocked: true },
    });
    expect(block.statusCode).toBe(200);
    const { res } = await impersonate(logged, BOSS, testerId);
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toBe('urn:vtiger-reader:problem:user-blocked');
  });
});

describe('the generated password', () => {
  it('follows the rules, is never cached and is new every time', async () => {
    const first = await admin.get('/api/admin/generated-password');
    const second = await admin.get('/api/admin/generated-password');
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(passwordProblem(first.body.password)).toBeNull();
    expect(passwordProblem(second.body.password)).toBeNull();
    expect(first.body.password).not.toBe(second.body.password);
  });
});
