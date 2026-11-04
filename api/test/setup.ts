import { afterAll, beforeAll, beforeEach } from 'vitest';
import { ensureLocalProfile } from '../src/modules/profile/profile.js';
import { closeTestDb, prepareTestDb, resetDatabase, testDb } from './support/db.js';

beforeAll(async () => {
  await prepareTestDb();
});

beforeEach(async () => {
  await resetDatabase();
  // The app's one profile, as the first start makes it (src/start.ts).
  await ensureLocalProfile(testDb());
});

afterAll(() => {
  closeTestDb();
});
