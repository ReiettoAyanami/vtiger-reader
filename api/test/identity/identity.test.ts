import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { ProblemError } from '../../src/shared/errors.js';
import { fixedClock } from '../support/api.js';
import { SESSION_COOKIE, signIn } from '../support/auth.js';
import { rawRows, testPool } from '../support/db.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({ pool: testPool(), clock: fixedClock, auth: { rateLimit: false } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

/** The problem an Identity call throws (status, code, field). */
async function problemOf(call: Promise<unknown>): Promise<{ status: number; code: string; field: string | undefined }> {
  try {
    await call;
  } catch (err) {
    if (err instanceof ProblemError) return { status: err.status, code: err.code, field: err.errors[0]?.field };
    throw err;
  }
  throw new Error('expected a problem');
}

describe('createUser', () => {
  it('a user: lowercase username and email, numeric id, credential account', async () => {
    const id = await app.identity.createUser({ username: 'Lenzi', email: 'Lenzi@Dev.Invalid', password: 'Lenzi-pass-0001', role: 'admin' });
    expect(Number.isInteger(id)).toBe(true);
    const [user] = await rawRows('SELECT username, email, role, name FROM users WHERE id = ?', [id]);
    expect(user).toEqual({ username: 'lenzi', email: 'lenzi@dev.invalid', role: 'admin', name: '' });
    const [account] = await rawRows('SELECT provider_id FROM accounts WHERE user_id = ?', [id]);
    expect(account?.provider_id).toBe('credential');
  });

  it('a user without a password has no credential account and cannot sign in', async () => {
    const id = await app.identity.createUser({ username: 'test-user', email: 'test-user@dev.invalid', password: null, role: 'user' });
    expect(await rawRows('SELECT id FROM accounts WHERE user_id = ?', [id])).toEqual([]);
    expect((await signIn(app, 'test-user', 'Whatever-pass-01')).status).toBe(401);
  });

  it('refuses a bad username: format, length, reserved words', async () => {
    const bad = (username: string) => app.identity.createUser({ username, email: `${username.length}x@dev.invalid`, password: 'Good-pass-0001!', role: 'user' });
    expect(await problemOf(bad('main.js'))).toMatchObject({ status: 400, field: 'username' });
    expect(await problemOf(bad('ab'))).toMatchObject({ status: 400, field: 'username' });
    expect(await problemOf(bad('a'.repeat(31)))).toMatchObject({ status: 400, field: 'username' });
    expect(await problemOf(bad('api'))).toMatchObject({ status: 400, field: 'username' });
    expect(await problemOf(bad('Login'))).toMatchObject({ status: 400, field: 'username' });
  });

  it('takes "admin": the admin panel lives under the administrator’s own username (lenzi, 2026-10-03)', async () => {
    await app.identity.createUser({ username: 'admin', email: 'admin@dev.invalid', password: 'Admin-pass-0001!', role: 'admin' });
    expect(await rawRows('SELECT username, role FROM users')).toEqual([{ username: 'admin', role: 'admin' }]);
    expect((await signIn(app, 'admin', 'Admin-pass-0001!')).status).toBe(200);
  });

  it('refuses a password that breaks the rules', async () => {
    const call = app.identity.createUser({ username: 'weak', email: 'weak@dev.invalid', password: 'no-digits-here!', role: 'user' });
    expect(await problemOf(call)).toMatchObject({ status: 400, field: 'password' });
    expect(await rawRows('SELECT id FROM users')).toEqual([]);
  });

  it('a username or an email already used: 409', async () => {
    await app.identity.createUser({ username: 'first', email: 'first@dev.invalid', password: 'First-pass-0001', role: 'user' });
    const sameName = app.identity.createUser({ username: 'FIRST', email: 'other@dev.invalid', password: 'First-pass-0001', role: 'user' });
    expect(await problemOf(sameName)).toMatchObject({ status: 409, code: 'username-taken' });
    const sameEmail = app.identity.createUser({ username: 'second', email: 'FIRST@dev.invalid', password: 'First-pass-0001', role: 'user' });
    expect(await problemOf(sameEmail)).toMatchObject({ status: 409, code: 'email-taken' });
  });
});

describe('setPassword', () => {
  it('gives a user without a password its credential account', async () => {
    const id = await app.identity.createUser({ username: 'test-user', email: 'test-user@dev.invalid', password: null, role: 'user' });
    await app.identity.setPassword(id, 'Test-user-pass-01');
    expect((await signIn(app, 'test-user', 'Test-user-pass-01')).status).toBe(200);
  });

  it('never a password the user already had, the current one included', async () => {
    const id = await app.identity.createUser({ username: 'rotating', email: 'rotating@dev.invalid', password: 'Original-pass-01', role: 'user' });
    await app.identity.setPassword(id, 'Second-pass-0002');
    await app.identity.setPassword(id, 'Third-pass-00003');
    for (const used of ['Third-pass-00003', 'Second-pass-0002', 'Original-pass-01']) {
      expect(await problemOf(app.identity.setPassword(id, used))).toMatchObject({ status: 409, code: 'password-used-before' });
    }
    expect(await rawRows('SELECT COUNT(*) AS n FROM password_history WHERE user_id = ?', [id])).toEqual([{ n: 2 }]);
    expect((await signIn(app, 'rotating', 'Third-pass-00003')).status).toBe(200);
  });

  it('closes every session of the user', async () => {
    const id = await app.identity.createUser({ username: 'signed', email: 'signed@dev.invalid', password: 'Signed-pass-0001', role: 'user' });
    const session = await signIn(app, 'signed', 'Signed-pass-0001');
    expect(await app.identity.userOf(new Headers({ cookie: session.cookie }))).not.toBeNull();
    await app.identity.setPassword(id, 'Signed-pass-0002');
    expect(await app.identity.userOf(new Headers({ cookie: session.cookie }))).toBeNull();
  });

  it('refuses a password that breaks the rules, and an unknown user', async () => {
    const id = await app.identity.createUser({ username: 'someone', email: 'someone@dev.invalid', password: 'Someone-pass-01', role: 'user' });
    expect(await problemOf(app.identity.setPassword(id, 'short-1!'))).toMatchObject({ status: 400, field: 'password' });
    expect(await problemOf(app.identity.setPassword(999_999, 'Long-enough-pass-1'))).toMatchObject({ status: 404 });
  });
});

describe('userOf', () => {
  it('who is asking: id, username, role, no impersonation', async () => {
    const id = await app.identity.createUser({ username: 'asker', email: 'asker@dev.invalid', password: 'Asker-pass-00001', role: 'admin' });
    const session = await signIn(app, 'asker', 'Asker-pass-00001');
    expect(await app.identity.userOf(new Headers({ cookie: session.cookie }))).toEqual({
      userId: id,
      username: 'asker',
      role: 'admin',
      impersonatedBy: null,
    });
    expect(await app.identity.userOf(new Headers())).toBeNull();
    expect(await app.identity.userOf(new Headers({ cookie: `${SESSION_COOKIE}=forged.value` }))).toBeNull();
  });

  it('an impersonation ends after an hour, and its session is gone', async () => {
    const adminId = await app.identity.createUser({ username: 'boss', email: 'boss@dev.invalid', password: 'Boss-pass-000001', role: 'admin' });
    await app.identity.createUser({ username: 'worker', email: 'worker@dev.invalid', password: 'Worker-pass-0001', role: 'user' });
    const session = await signIn(app, 'worker', 'Worker-pass-0001');
    const token = decodeURIComponent(session.cookie.split('=')[1] ?? '').split('.')[0];
    await testPool().query('UPDATE sessions SET impersonated_by = ? WHERE token = ?', [adminId, token]);
    expect((await app.identity.userOf(new Headers({ cookie: session.cookie })))?.impersonatedBy).toBe(adminId);
    await testPool().query('UPDATE sessions SET created_at = NOW(3) - INTERVAL 61 MINUTE WHERE token = ?', [token]);
    expect(await app.identity.userOf(new Headers({ cookie: session.cookie }))).toBeNull();
    expect(await rawRows('SELECT id FROM sessions WHERE token = ?', [token])).toEqual([]);
  });
});
