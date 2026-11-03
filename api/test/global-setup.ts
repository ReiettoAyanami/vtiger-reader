import { runMigrations } from '../src/db/migrate.js';
import { testDbConfig } from './support/db.js';

/** Once per test run: bring the test database schema up to date. */
export default async function setup(): Promise<void> {
  await runMigrations(testDbConfig());
}
