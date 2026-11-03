import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { USAGE, runCli } from '../../src/cli.js';
import { passwordProblem } from '../../src/modules/identity/passwords.js';
import { expectProblem, makeApi, type Api } from '../support/api.js';
import { signIn } from '../support/auth.js';
import { TESTER, cookieOf, idOf, type TestUser } from '../support/session.js';

const BOSS: TestUser = { username: 'boss', password: 'Boss-pass-000001', role: 'admin' };

let api: Api;
beforeAll(async () => {
  api = await makeApi();
});
afterAll(async () => {
  await api.app.close();
});

/** Runs the command line against the test database; what it printed and its exit code. */
async function cli(...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(args, api.app.identity, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out, err };
}

describe('node dist/cli.js reset-password <username>', () => {
  it('gives the user a new password that follows the rules, printed once, and closes their sessions', async () => {
    await idOf(api.app, TESTER);
    const before = await cookieOf(api.app, TESTER);

    const { code, out, err } = await cli('reset-password', 'Tester');
    expect(code).toBe(0);
    expect(err).toEqual([]);
    const password = /^New password for tester: (\S+)$/.exec(out[0] ?? '')?.[1] ?? '';
    expect(passwordProblem(password)).toBeNull();
    expect(out[1]).toBe('It is shown only this once. Their sessions are closed: they sign in again with it.');

    expectProblem(await api.get('/api/settings').then((r) => r), 401, 'unauthenticated');
    expect(before).not.toBe('');
    expect((await signIn(api.app, 'tester', TESTER.password)).status).toBe(401);
    expect((await signIn(api.app, 'tester', password)).status).toBe(200);
  });

  it('works for an administrator too', async () => {
    await idOf(api.app, BOSS);
    const { code, out } = await cli('reset-password', 'boss');
    expect(code).toBe(0);
    const password = out[0]?.split(': ')[1] ?? '';
    expect((await signIn(api.app, 'boss', password)).status).toBe(200);
  });

  it('a user that does not exist: exit code 1, nothing printed on the output', async () => {
    expect(await cli('reset-password', 'nobody')).toEqual({ code: 1, out: [], err: ['There is no user called "nobody".'] });
  });

  it('anything else: the usage, exit code 2', async () => {
    for (const args of [[], ['reset-password'], ['delete-user', 'tester'], ['reset-password', 'a', 'b']]) {
      expect(await cli(...args)).toEqual({ code: 2, out: [], err: [USAGE] });
    }
  });
});
