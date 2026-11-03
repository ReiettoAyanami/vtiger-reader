import { afterAll, beforeEach } from 'vitest';
import { closeTestPool, resetDatabase } from './support/db.js';
import { forgetTestUsers } from './support/session.js';

beforeEach(async () => {
  await resetDatabase();
  forgetTestUsers();
});

afterAll(async () => {
  await closeTestPool();
});
