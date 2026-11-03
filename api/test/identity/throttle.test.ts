import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { SIGN_IN_DELAY, delayAfter, type SignInDelay } from '../../src/modules/identity/throttle.js';
import { fixedClock } from '../support/api.js';
import { signIn } from '../support/auth.js';
import { rawRows, testPool } from '../support/db.js';

describe('the waits, with the numbers lenzi approved', () => {
  it('nothing for the first 5 wrong passwords in a row, then 2 s, doubling up to 60 s', () => {
    const waits = Array.from({ length: 12 }, (_, failures) => delayAfter(failures, SIGN_IN_DELAY));
    expect(waits).toEqual([0, 0, 0, 0, 0, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  });
});

// The same rule with short waits, so that the tests take tenths of a second: after 2 wrong passwords,
// 300 ms, doubling up to 1200 ms.
const SHORT: SignInDelay = { afterFailures: 2, firstMs: 300, maxMs: 1_200 };
const PASSWORD = 'Lenzi-pass-0001';

/**
 * The waits the throttle asks for, really waited. "No wait" is checked here, never on the clock: how
 * long an attempt takes without one (the password hash, the database) depends on the machine, and
 * a busy CI runner made a 250 ms bound fail (2026-10-05). A slow machine only makes the waits that
 * are checked on the clock (at least so many ms) longer.
 */
let asked: number[] = [];
const recordingSleep = (ms: number) => {
  asked.push(ms);
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
};

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp({
    pool: testPool(),
    clock: fixedClock,
    auth: { rateLimit: false, signInDelay: SHORT, signInSleep: recordingSleep },
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

/** A sign-in, how long its answer took, and the waits it was made to do (on `app`). */
async function timed(
  username: string,
  password: string,
  on: FastifyInstance = app,
): Promise<{ status: number; ms: number; waits: number[] }> {
  asked = [];
  const started = performance.now();
  const res = await signIn(on, username, password);
  return { status: res.status, ms: performance.now() - started, waits: asked };
}

const lenzi = () => app.identity.createUser({ username: 'lenzi', email: 'lenzi@dev.invalid', password: PASSWORD, role: 'admin' });

describe('wrong passwords in a row', () => {
  it('slow down the next attempts, the waits doubling', async () => {
    await lenzi();
    expect((await timed('lenzi', 'Wrong-pass-00001')).waits).toEqual([]);
    expect((await timed('lenzi', 'Wrong-pass-00002')).waits).toEqual([]);
    // 2 in a row: the third waits 300 ms, the fourth 600 (counted from the last failure: a little less)
    const third = await timed('lenzi', 'Wrong-pass-00003');
    expect(third).toMatchObject({ status: 401 });
    expect(third.ms).toBeGreaterThanOrEqual(280);
    expect(third.waits).toHaveLength(1);
    expect(third.waits[0]).toBeGreaterThan(0);
    expect(third.waits[0]).toBeLessThanOrEqual(300);
    const fourth = await timed('lenzi', 'Wrong-pass-00004');
    expect(fourth.ms).toBeGreaterThanOrEqual(580);
    expect(fourth.waits[0]).toBeGreaterThan(300); // doubled
    expect(fourth.waits[0]).toBeLessThanOrEqual(600);
    expect(await rawRows('SELECT failures FROM sign_in_failures')).toEqual([{ failures: 4 }]);
  });

  it('never keep the user out: the right password gets in after the wait, and sets the count back to nothing', async () => {
    await lenzi();
    for (let i = 0; i < 4; i++) await timed('Lenzi', `Wrong-pass-0000${i}`); // any case is the same user
    const right = await timed('lenzi', PASSWORD);
    expect(right.status).toBe(200);
    expect(right.ms).toBeGreaterThanOrEqual(1_000); // 1200 ms after the last failure, the cap
    expect(await rawRows('SELECT failures FROM sign_in_failures')).toEqual([{ failures: 0 }]);
    expect((await timed('lenzi', 'Wrong-pass-00009')).waits).toEqual([]);
  });

  it('a wait already spent between two attempts is not waited again', async () => {
    await lenzi();
    await timed('lenzi', 'Wrong-pass-00001');
    await timed('lenzi', 'Wrong-pass-00002');
    await new Promise((resolve) => setTimeout(resolve, 350));
    const right = await timed('lenzi', PASSWORD);
    expect(right.status).toBe(200);
    expect(right.waits).toEqual([]);
  });

  it('a username nobody has waits the same: the waits do not tell who exists', async () => {
    await timed('nobody', 'Wrong-pass-00001');
    await timed('nobody', 'Wrong-pass-00002');
    const third = await timed('nobody', 'Wrong-pass-00003');
    expect(third.status).toBe(401);
    expect(third.ms).toBeGreaterThanOrEqual(280);
    expect(await rawRows('SELECT COUNT(*) AS n FROM sign_in_failures')).toEqual([{ n: 0 }]);
  });

  it('are kept in the database: a restart does not forget them', async () => {
    await lenzi();
    await timed('lenzi', 'Wrong-pass-00001');
    await timed('lenzi', 'Wrong-pass-00002');
    // A wait of 2 s after the restart, counted from the last failure: building the app again (slow
    // when the whole suite runs) cannot use it up.
    const restarted = await buildApp({
      pool: testPool(),
      clock: fixedClock,
      auth: { rateLimit: false, signInDelay: { afterFailures: 2, firstMs: 2_000, maxMs: 2_000 } },
    });
    await restarted.ready();
    try {
      expect((await timed('lenzi', 'Wrong-pass-00003', restarted)).ms).toBeGreaterThanOrEqual(500);
      expect(await rawRows('SELECT failures FROM sign_in_failures')).toEqual([{ failures: 3 }]);
    } finally {
      await restarted.close();
    }
  });

  it('go with the user when the user is deleted', async () => {
    const id = await lenzi();
    await timed('lenzi', 'Wrong-pass-00001');
    await app.accounts.deleteUser(id);
    expect(await rawRows('SELECT COUNT(*) AS n FROM sign_in_failures')).toEqual([{ n: 0 }]);
  });

  it('only a wrong password counts: a refused shape, or a blocked user, does not', async () => {
    const id = await lenzi();
    expect((await signIn(app, 'a.b', 'Wrong-pass-00001')).status).toBe(422);
    await app.identity.updateUser(id, { blocked: true });
    expect((await signIn(app, 'lenzi', PASSWORD)).status).toBe(403);
    expect(await rawRows('SELECT COUNT(*) AS n FROM sign_in_failures WHERE failures > 0')).toEqual([{ n: 0 }]);
  });
});
