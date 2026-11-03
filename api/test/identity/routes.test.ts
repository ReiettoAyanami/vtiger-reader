import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { fixedClock } from '../support/api.js';
import { ORIGIN, SESSION_COOKIE, signIn } from '../support/auth.js';
import { rawRows, testPool } from '../support/db.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ pool: testPool(), clock: fixedClock, auth: { rateLimit: false } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

const lenzi = () => app.identity.createUser({ username: 'lenzi', email: 'lenzi@dev.invalid', password: 'Lenzi-pass-0001', role: 'admin' });

describe('sign in by username', () => {
  it('any case; an HttpOnly, SameSite=Lax session cookie, not Secure over http', async () => {
    await lenzi();
    const res = await signIn(app, 'LENZI', 'Lenzi-pass-0001');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ username: 'lenzi', role: 'admin' });
    const cookie = res.response.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    expect(cookie?.secure).toBeFalsy();
    expect(cookie?.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it('a wrong password and an unknown user get the same 401 problem', async () => {
    await lenzi();
    const wrong = await signIn(app, 'lenzi', 'Wrong-pass-00001');
    const nobody = await signIn(app, 'nobody', 'Wrong-pass-00001');
    expect(wrong.status).toBe(401);
    expect(nobody.status).toBe(401);
    expect(String(wrong.response.headers['content-type'])).toContain('application/problem+json');
    expect(wrong.body).toEqual(nobody.body);
    expect(wrong.body).toMatchObject({ status: 401, type: 'urn:vtiger-reader:problem:invalid-username-or-password' });
    expect(wrong.cookie).toBe('');
  });

  it('the session is a row of sessions, 30 days, with the client IP', async () => {
    const id = await lenzi();
    await signIn(app, 'lenzi', 'Lenzi-pass-0001');
    const [row] = await rawRows('SELECT user_id, ip_address, TIMESTAMPDIFF(DAY, NOW(3), expires_at) AS days FROM sessions');
    expect(row).toMatchObject({ user_id: id, ip_address: '127.0.0.1' });
    expect([29, 30]).toContain(Number(row?.days));
  });
});

describe('only JSON, from the app itself or the Android app', () => {
  const post = (headers: Record<string, string>, payload = '{"username":"lenzi","password":"Lenzi-pass-0001"}') =>
    app.inject({ method: 'POST', url: '/api/auth/sign-in/username', headers, payload });

  it('another origin, even "null": 403', async () => {
    await lenzi();
    for (const origin of ['http://evil.example', 'null', `${ORIGIN}.evil.example`]) {
      const res = await post({ origin, 'content-type': 'application/json' });
      expect(res.statusCode, origin).toBe(403);
      expect(res.json()).toMatchObject({ type: 'urn:vtiger-reader:problem:origin' });
      expect(res.cookies).toEqual([]);
    }
  });

  it('no origin at all (the Android app\'s native requests): signs in', async () => {
    await lenzi();
    const res = await post({ 'content-type': 'application/json' });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)?.value).toBeTruthy();
  });

  it('no origin, with the session cookie: sign-out and revoke-other-sessions work (Better Auth sees APP_URL)', async () => {
    await lenzi();
    const phone = await signIn(app, 'lenzi', 'Lenzi-pass-0001');
    const laptop = await signIn(app, 'lenzi', 'Lenzi-pass-0001');
    const revoke = await app.inject({ method: 'POST', url: '/api/auth/revoke-other-sessions', headers: { 'content-type': 'application/json', cookie: phone.cookie }, payload: '{}' });
    expect(revoke.statusCode).toBe(200);
    expect(await app.identity.userOf(new Headers({ cookie: laptop.cookie }))).toBeNull();
    const out = await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { 'content-type': 'application/json', cookie: phone.cookie }, payload: '{}' });
    expect(out.statusCode).toBe(200);
    expect(await rawRows('SELECT id FROM sessions')).toEqual([]);
  });

  it('another origin with the session cookie: 403, the session stays', async () => {
    await lenzi();
    const res = await signIn(app, 'lenzi', 'Lenzi-pass-0001');
    const out = await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { origin: 'http://evil.example', 'content-type': 'application/json', cookie: res.cookie }, payload: '{}' });
    expect(out.statusCode).toBe(403);
    expect(await app.identity.userOf(new Headers({ cookie: res.cookie }))).not.toBeNull();
  });

  it('a form or plain text: 415', async () => {
    await lenzi();
    const form = await post({ origin: ORIGIN, 'content-type': 'application/x-www-form-urlencoded' }, 'username=lenzi&password=Lenzi-pass-0001');
    expect(form.statusCode).toBe(415);
    const text = await post({ origin: ORIGIN, 'content-type': 'text/plain' });
    expect(text.statusCode).toBe(415);
    expect(await rawRows('SELECT id FROM sessions')).toEqual([]);
  });
});

describe('only the endpoints the app uses', () => {
  it('sign-up, sign-in by email, the library admin routes and odd paths: 404', async () => {
    await lenzi();
    const admin = await signIn(app, 'lenzi', 'Lenzi-pass-0001');
    const headers = { origin: ORIGIN, 'content-type': 'application/json', cookie: admin.cookie };
    for (const url of [
      '/api/auth/sign-up/email',
      '/api/auth/sign-in/email',
      '/api/auth/admin/create-user',
      '/api/auth/admin/set-role',
      '/api/auth/admin/remove-user',
      '/api/auth/admin/set-user-password',
      '/api/auth/admin/impersonate-user',
      '/api/auth//sign-in/username',
      '/api/auth/sign-in/username/',
      '/api/auth/change-password',
    ]) {
      const res = await app.inject({ method: 'POST', url, headers, payload: '{"email":"x@dev.invalid","password":"Xxxxxxxxxxxx-1","name":"x","userId":"1","role":"user"}' });
      expect(res.statusCode, url).toBe(404);
    }
    expect(await rawRows('SELECT username, role FROM users')).toEqual([{ username: 'lenzi', role: 'admin' }]);
  });
});

describe('the session, sign out, the other devices', () => {
  it('get-session answers with the user, or null', async () => {
    await lenzi();
    const res = await signIn(app, 'lenzi', 'Lenzi-pass-0001');
    const mine = await app.inject({ method: 'GET', url: '/api/auth/get-session', headers: { cookie: res.cookie } });
    expect(mine.json().user).toMatchObject({ username: 'lenzi' });
    // the token lives in the HttpOnly cookie only: never in a body a script could read
    expect(mine.json().session.token).toBeUndefined();
    expect(res.body.token).toBeUndefined();
    expect(JSON.stringify(mine.json())).not.toContain(decodeURIComponent(res.cookie.split('=')[1] ?? '').split('.')[0]);
    const none = await app.inject({ method: 'GET', url: '/api/auth/get-session' });
    expect(none.statusCode).toBe(200);
    expect(none.json()).toBeNull();
  });

  it('sign-out deletes the session row and expires the cookie', async () => {
    await lenzi();
    const res = await signIn(app, 'lenzi', 'Lenzi-pass-0001');
    const out = await app.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: res.cookie }, payload: '{}' });
    expect(out.statusCode).toBe(200);
    expect(out.cookies.find((c) => c.name === SESSION_COOKIE)?.maxAge).toBe(0);
    expect(await rawRows('SELECT id FROM sessions')).toEqual([]);
  });

  it('revoke-other-sessions keeps this one only', async () => {
    await lenzi();
    const phone = await signIn(app, 'lenzi', 'Lenzi-pass-0001');
    const laptop = await signIn(app, 'lenzi', 'Lenzi-pass-0001');
    const res = await app.inject({ method: 'POST', url: '/api/auth/revoke-other-sessions', headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: laptop.cookie }, payload: '{}' });
    expect(res.statusCode).toBe(200);
    expect(await app.identity.userOf(new Headers({ cookie: laptop.cookie }))).not.toBeNull();
    expect(await app.identity.userOf(new Headers({ cookie: phone.cookie }))).toBeNull();
  });
});

describe('sign-in counters (rate limit) in the database', () => {
  it('the 4th sign-in in 10 s from one address: 429 problem with Retry-After; rows of rate_limits', async () => {
    const limited = await buildApp({ pool: testPool(), clock: fixedClock });
    try {
      await limited.identity.createUser({ username: 'lenzi', email: 'lenzi@dev.invalid', password: 'Lenzi-pass-0001', role: 'admin' });
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await signIn(limited, 'lenzi', 'Wrong-pass-00001')).status);
      expect(statuses).toEqual([401, 401, 401, 429]);
      const blocked = await signIn(limited, 'lenzi', 'Lenzi-pass-0001');
      expect(blocked.status).toBe(429);
      expect(blocked.body).toMatchObject({ status: 429, type: 'urn:vtiger-reader:problem:too-many-requests' });
      expect(Number(blocked.response.headers['retry-after'])).toBeGreaterThan(0);
      expect((await rawRows('SELECT COUNT(*) AS n FROM rate_limits'))[0]?.n).toBeGreaterThan(0);
    } finally {
      await limited.close();
    }
  });

  it('the client IP comes from CLIENT_IP_HEADER when set (its last value), never from a header of ours sent by the client', async () => {
    const proxied = await buildApp({ pool: testPool(), clock: fixedClock, auth: { clientIpHeader: 'x-forwarded-for' } });
    try {
      await proxied.identity.createUser({ username: 'lenzi', email: 'lenzi@dev.invalid', password: 'Lenzi-pass-0001', role: 'admin' });
      // three different clients behind the proxy, each with a spoofed address in front
      for (const client of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) {
        expect((await signIn(proxied, 'lenzi', 'Wrong-pass-00001', { 'x-forwarded-for': `10.9.9.9, ${client}` })).status).toBe(401);
      }
      // one client, even when it claims another address under our own header
      const one = { 'x-forwarded-for': '203.0.113.9' };
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await signIn(proxied, 'lenzi', 'Wrong-pass-00001', { ...one, 'x-vtiger-reader-client-ip': `192.0.2.${i}` })).status);
      expect(statuses).toEqual([401, 401, 401, 429]);
      const ok = await signIn(proxied, 'lenzi', 'Lenzi-pass-0001', { 'x-forwarded-for': '203.0.113.10' });
      expect(ok.status).toBe(200);
      const [row] = await rawRows('SELECT ip_address FROM sessions');
      expect(row?.ip_address).toBe('203.0.113.10');
    } finally {
      await proxied.close();
    }
  });
});
