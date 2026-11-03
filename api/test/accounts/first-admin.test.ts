import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { ensureFirstAdmin } from '../../src/modules/accounts/first-admin.js';
import { passwordProblem } from '../../src/modules/identity/passwords.js';
import { fixedClock } from '../support/api.js';
import { signIn } from '../support/auth.js';
import { rawRows, testPool } from '../support/db.js';

let app: FastifyInstance;
let logs: string[];
let dir: string;

beforeAll(async () => {
  logs = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      logs.push(String(chunk));
      done();
    },
  });
  app = await buildApp({ pool: testPool(), clock: fixedClock, logger: { level: 'info', stream }, auth: { rateLimit: false } });
  await app.ready();
  dir = await mkdtemp(join(tmpdir(), 'first-admin-'));
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  logs.length = 0;
});

const ensure = (config: { username?: string; email?: string; passwordFile?: string }) =>
  ensureFirstAdmin(
    { pool: testPool(), accounts: app.accounts, log: app.log },
    {
      username: config.username,
      email: config.email ?? 'lenzi@dev.invalid',
      passwordFile: config.passwordFile ?? join(dir, 'to_delete.password.txt'),
    },
  );

describe('the first administrator', () => {
  it('is created at the first start, its password in to_delete.password.txt and never in the log', async () => {
    const file = join(dir, 'first.txt');
    expect(await ensure({ username: 'lenzi', passwordFile: file })).toBe('created');

    const text = await readFile(file, 'utf8');
    expect(text).toMatch(/^username: lenzi$/m);
    const password = /^password: (.+)$/m.exec(text)?.[1] ?? '';
    expect(passwordProblem(password)).toBeNull();
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await signIn(app, 'lenzi', password)).status).toBe(200);

    expect(await rawRows("SELECT username, email, role FROM users")).toEqual([{ username: 'lenzi', email: 'lenzi@dev.invalid', role: 'admin' }]);
    // ready to use: settings and layout
    expect(await rawRows('SELECT currency FROM settings')).toEqual([{ currency: 'EUR' }]);
    expect((await rawRows('SELECT COUNT(*) AS n FROM view_items'))[0]?.n).toBeGreaterThan(0);

    expect(logs.join('')).toContain(file);
    expect(logs.join('')).not.toContain(password);
  });

  it('nothing happens once an administrator exists', async () => {
    await app.identity.createUser({ username: 'boss', email: 'boss@dev.invalid', password: 'Boss-pass-000001', role: 'admin' });
    const file = join(dir, 'not-written.txt');
    expect(await ensure({ username: 'lenzi', passwordFile: file })).toBe('exists');
    await expect(stat(file)).rejects.toThrow();
    expect(await rawRows('SELECT username FROM users')).toEqual([{ username: 'boss' }]);
  });

  it('without ADMIN_USERNAME none is created, and the log says so', async () => {
    expect(await ensure({})).toBe('not-configured');
    expect(await rawRows('SELECT id FROM users')).toEqual([]);
    expect(logs.join('')).toContain('ADMIN_USERNAME');
  });

  it('a username already taken by a user who is not an administrator: none is created, the log says why', async () => {
    await app.identity.createUser({ username: 'lenzi', email: 'someone@dev.invalid', password: 'Someone-pass-01', role: 'user' });
    const file = join(dir, 'taken.txt');
    expect(await ensure({ username: 'lenzi', passwordFile: file })).toBe('failed');
    expect(await rawRows("SELECT username, role FROM users")).toEqual([{ username: 'lenzi', role: 'user' }]);
    await expect(stat(file)).rejects.toThrow();
    expect(logs.join('')).toContain('could not be created');
  });

  it('a username that cannot be one (a reserved word, the wrong letters): none is created, the log says which rule', async () => {
    expect(await ensure({ username: 'login' })).toBe('failed');
    expect(logs.join('')).toContain('The first administrator \\"login\\" could not be created: \\"login\\" is a reserved word');
    logs.length = 0;
    expect(await ensure({ username: 'Lenzi.Admin' })).toBe('failed');
    expect(logs.join('')).toContain('can only have lowercase letters, digits, - and _');
    expect(await rawRows('SELECT id FROM users')).toEqual([]);
  });

  it('"admin", the default of the compose files (lenzi, 2026-10-03), is a username like any other', async () => {
    const file = join(dir, 'admin.txt');
    expect(await ensure({ username: 'admin', email: 'admin@example.invalid', passwordFile: file })).toBe('created');

    const password = /^password: (.+)$/m.exec(await readFile(file, 'utf8'))?.[1] ?? '';
    expect((await signIn(app, 'admin', password)).status).toBe(200);
    expect(await rawRows('SELECT username, role FROM users')).toEqual([{ username: 'admin', role: 'admin' }]);
  });

  it('when the file cannot be written: the administrator stays, the log says how to give it a password', async () => {
    const file = join(dir, 'missing-folder', 'to_delete.password.txt');
    expect(await ensure({ username: 'lenzi', passwordFile: file })).toBe('created-without-file');
    expect(await rawRows("SELECT username, role FROM users")).toEqual([{ username: 'lenzi', role: 'admin' }]);
    expect(logs.join('')).toContain('reset-password lenzi');
  });
});
