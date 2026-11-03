import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { createPool, type Pool } from '../../src/db/pool.js';
import { fixedClock } from '../support/api.js';
import { signIn } from '../support/auth.js';
import { testDbConfig } from '../support/db.js';

/**
 * Better Auth reads a row it has just inserted back with LAST_INSERT_ID(), on whatever connection
 * the pool hands out. Without insert-memory.ts, under load, a sign-in came back with another user's
 * session (design-accounts.md, "Identity as built (1.1)": 41 of 200). A pool of two connections
 * and inserts of the rest of the API running at the same time make the pool hand connections
 * around; every cookie must still hold its own user's session.
 */

let pool: Pool;
let app: FastifyInstance;
beforeAll(async () => {
  pool = createPool(testDbConfig(), { connectionLimit: 2 });
  app = await buildApp({ pool, clock: fixedClock, auth: { rateLimit: false } });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('concurrent sign-ins on a small pool', () => {
  it('each cookie holds its own user session', async () => {
    const users = ['ann', 'bob', 'cid', 'dee', 'eve', 'fay'];
    const ids: number[] = [];
    for (const name of users) {
      ids.push(await app.identity.createUser({ username: name, email: `${name}@dev.invalid`, password: 'Racer-pass-0001', role: 'user' }));
    }
    const noise = async () => {
      for (let i = 0; i < 150; i++) {
        await pool.query("UPDATE user_settings SET timezone = 'Europe/Rome' WHERE user_id = ?", [ids[0]]);
      }
    };
    let wrong = 0;
    let failed = 0;
    const signIns = async (worker: number) => {
      for (let i = 0; i < 15; i++) {
        const name = users[(i + worker) % users.length] as string;
        const res = await signIn(app, name, 'Racer-pass-0001');
        if (res.status !== 200) {
          failed++;
          continue;
        }
        const who = await app.identity.userOf(new Headers({ cookie: res.cookie }));
        if (who?.username !== name || res.body.user?.username !== name) wrong++;
      }
    };
    await Promise.all([noise(), noise(), ...Array.from({ length: 8 }, (_, worker) => signIns(worker))]);
    expect({ wrong, failed }).toEqual({ wrong: 0, failed: 0 });
  });
});
