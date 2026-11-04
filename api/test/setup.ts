import { afterAll, beforeEach } from 'vitest';
import { ensureLocalProfile } from '../src/modules/profile/profile.js';
import { closeTestPool, resetDatabase, testPool } from './support/db.js';

beforeEach(async () => {
  await resetDatabase();
  // The app's one profile, as the first start makes it (server.ts).
  await ensureLocalProfile(testPool());
});

afterAll(async () => {
  await closeTestPool();
});
