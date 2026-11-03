import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { fixedClock } from '../support/api.js';
import { ORIGIN } from '../support/auth.js';
import { rawRows, testPool } from '../support/db.js';

/**
 * At the first start of an instance the API is built before the migrations create the tables
 * (server.ts). Better Auth must not decide the schema is wrong at that moment and keep thinking so:
 * the first administrator would not be created and every sign-in would fail until a restart (seen
 * on a new demo database, 2026-10-03). The schema is ours (the numbered migrations), the tests
 * check every auth path on it.
 */
describe('Better Auth and a schema that is not there yet', () => {
  it('a table missing while the app starts, there right after: users are created and sign in', async () => {
    await rawRows('RENAME TABLE verifications TO verifications_later');
    const app = await buildApp({ pool: testPool(), clock: fixedClock, auth: { rateLimit: false } });
    try {
      await app.ready();
      // Something asks Better Auth while the table is still missing (the first request, the
      // first-administrator check).
      await app.identity.userOf(new Headers()).catch(() => undefined);
      await rawRows('RENAME TABLE verifications_later TO verifications');

      const id = await app.identity.createUser({ username: 'lenzi', email: 'lenzi@dev.invalid', password: 'Lenzi-pass-0001', role: 'admin' });
      expect(id).toBeGreaterThan(0);
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/username',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        payload: JSON.stringify({ username: 'lenzi', password: 'Lenzi-pass-0001' }),
      });
      expect(res.statusCode, res.body).toBe(200);
    } finally {
      const [table] = await rawRows("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'verifications_later'");
      if (Number(table?.n) > 0) await rawRows('RENAME TABLE verifications_later TO verifications');
      await app.close();
    }
  });
});
