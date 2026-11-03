import type { FastifyInstance } from 'fastify';
import type { Role } from '../../src/modules/identity/identity.js';
import { signIn } from './auth.js';

/**
 * The users of the tests. Each is created on first use in a test (the database is emptied before
 * every test) with its credentials only: no settings row (the API answers with the defaults) and no
 * layout (an empty page, as the view-items tests expect). Its session is kept until the test ends.
 */
export interface TestUser {
  username: string;
  password: string;
  role: Role;
}

/** Whom the test Api works as by default. */
export const TESTER: TestUser = { username: 'tester', password: 'Tester-pass-0001', role: 'user' };
/** Another user, for the cross-user tests. */
export const OTHER: TestUser = { username: 'other-user', password: 'Other-pass-00001', role: 'user' };

const cookies = new Map<string, string>();
const ids = new Map<string, number>();

/** Called before every test, with the database reset. */
export function forgetTestUsers(): void {
  cookies.clear();
  ids.clear();
}

async function ensure(app: FastifyInstance, user: TestUser): Promise<void> {
  if (cookies.has(user.username)) return;
  const id = await app.identity.createUser({
    username: user.username,
    email: `${user.username}@test.invalid`,
    password: user.password,
    role: user.role,
  });
  const res = await signIn(app, user.username, user.password);
  if (res.status !== 200) throw new Error(`the sign-in of ${user.username} failed: ${res.status} ${JSON.stringify(res.body)}`);
  ids.set(user.username, id);
  cookies.set(user.username, res.cookie);
}

/** The session cookie of a test user, creating the user and signing in the first time. */
export async function cookieOf(app: FastifyInstance, user: TestUser): Promise<string> {
  await ensure(app, user);
  return cookies.get(user.username) as string;
}

/** The id of a test user, creating it the first time. */
export async function idOf(app: FastifyInstance, user: TestUser): Promise<number> {
  await ensure(app, user);
  return ids.get(user.username) as number;
}
