import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { openDatabase } from '../../src/db/database.js';
import { Api, expectProblem, fixedClock, makeApi } from '../support/api.js';
import { testDb } from '../support/db.js';
import { API_LEVEL, VERSION, VERSION_FORMAT } from '../../src/version.js';

let api: Api;
beforeAll(async () => {
  api = await makeApi();
});
afterAll(async () => {
  await api.app.close();
});

describe('GET /api/health', () => {
  it('200 when the database answers', async () => {
    const res = await api.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok' });
  });

  it('503 problem when it does not', async () => {
    const dead = openDatabase(':memory:');
    dead.close();
    const app = await buildApp({ db: dead, clock: fixedClock });
    try {
      const res = await new Api(app).get('/api/health');
      expectProblem(res, 503, 'database-unavailable');
      expect(res.body.db).toBe('error');
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/version', () => {
  it('the product version, in the agreed format', async () => {
    const res = await api.get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: VERSION, apiLevel: API_LEVEL });
    expect(VERSION).toMatch(VERSION_FORMAT);
  });

  it('the API level is a whole number from 1: the Android app compares it (design-android.md, "compatibility")', () => {
    expect(Number.isInteger(API_LEVEL)).toBe(true);
    expect(API_LEVEL).toBeGreaterThanOrEqual(1);
  });

  it('the format: a four-digit build at the end, dev may carry a short text, final versions are numbers only', () => {
    for (const ok of [
      'dev26.0.0.0000',
      'dev26.12.3.0042',
      'dev26.0.1.0000-squircle',
      'dev26.0.1.0003-new-login',
      'a26.0.0.0001',
      'b26.1.2.0000',
      'v27.3.10.9999',
    ]) {
      expect(ok).toMatch(VERSION_FORMAT);
    }
    for (const bad of [
      '26.0.0.0000',
      'a26.0.0', // the build is required: before 2026-10-05 it was not there
      'dev26.0.0-squircle',
      'a26.0.0.1', // four digits
      'a26.0.0.00001',
      'dev26.0.0.0000.0000',
      'a26.0.1.0000-test',
      'v26.x.0.0000',
      'dev2026.0.0.0000',
      'dev26.0.0.0000-',
      'rc26.0.0.0000',
    ]) {
      expect(bad).not.toMatch(VERSION_FORMAT);
    }
  });
});

describe('Problem Details', () => {
  it('unknown /api routes are a 404 problem', async () => {
    expectProblem(await api.get('/api/nope'), 404, 'not-found');
    expectProblem(await api.post('/api/settings/1/nothing', {}), 404, 'not-found');
    expectProblem(await api.get('/api'), 404, 'not-found');
  });

  it('without a web build, non-API paths are a 404 problem too', async () => {
    expectProblem(await api.get('/'), 404);
    expectProblem(await api.get('/some/deep/route'), 404);
  });

  it('validation errors list the fields', async () => {
    const res = await api.patch('/api/settings', { timezone: 'x'.repeat(65) });
    expectProblem(res, 400, 'validation');
    expect(res.body.errors).toEqual([{ field: 'timezone', message: expect.any(String) }]);
  });

  it('malformed JSON is a 400 problem', async () => {
    const res = await api.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { 'content-type': 'application/json' },
      payload: '{"timezone": ',
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('an unsupported media type is a 415 problem', async () => {
    const res = await api.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { 'content-type': 'application/xml' },
      payload: '<settings/>',
    });
    expect(res.statusCode).toBe(415);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });
});

describe('static files and SPA fallback (WEB_DIST)', () => {
  let dir: string;
  let web: Api;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'st-web-'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><html><body><app-root></app-root></body></html>');
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'assets', 'main.js'), 'console.log("hi");');
    web = await makeApi({ webDist: dir });
  });
  afterAll(async () => {
    await web.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('serves index.html at / and for deep client routes', async () => {
    for (const url of ['/', '/some/deep/route', '/lenzi/tickets/12?tab=comments']) {
      const res = await web.get(url);
      expect(res.status, url).toBe(200);
      expect(String(res.headers['content-type'])).toContain('text/html');
      expect(res.body).toContain('<app-root>');
    }
  });

  it('serves real static files', async () => {
    const res = await web.get('/assets/main.js');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'])).toContain('javascript');
    expect(res.body).toBe('console.log("hi");');
  });

  it('keeps /api/* as JSON: routes work, unknown ones are 404 problems', async () => {
    expect((await web.get('/api/health')).body).toEqual({ status: 'ok', db: 'ok' });
    expectProblem(await web.get('/api/does-not-exist'), 404, 'not-found');
  });

  it('only GET/HEAD fall back to index.html', async () => {
    expectProblem(await web.post('/some/deep/route', {}), 404);
    const head = await web.req('HEAD', '/some/deep/route');
    expect(head.status).toBe(200);
  });
});

describe('security headers (lenzi, 2026-10-03: "si")', () => {
  // The whole policy, spelled out: a change to it is a decision, not a side effect.
  const POLICY =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self'; object-src 'none'; " +
    "base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
  let dir: string;
  let web: Api;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'st-web-'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><html><body><app-root></app-root></body></html>');
    await writeFile(join(dir, 'main.js'), 'console.log("hi");');
    web = await makeApi({ webDist: dir });
  });
  afterAll(async () => {
    await web.app.close();
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    ['the app', 'GET', '/'],
    ['a deep page of the app', 'GET', '/tickets/17x1'],
    ['a file of the build', 'GET', '/main.js'],
    ['an API answer', 'GET', '/api/health'],
    ['an API answer of the profile', 'GET', '/api/settings'],
    ['an API error (no such route)', 'GET', '/api/nothing-here'],
  ] as const)('on every answer: %s', async (_what, method, url) => {
    const res = await web.req(method, url);
    expect(res.headers['content-security-policy']).toBe(POLICY);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('same-origin');
    // Opened over http (APP_URL): a browser ignores HSTS there, and it is never sent.
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });

  it('HSTS only for an instance opened over https: the browser keeps to https for a year', async () => {
    const app = await buildApp({ db: testDb(), clock: fixedClock, appUrl: 'https://tickets.example.invalid' });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/version' });
      expect(res.headers['strict-transport-security']).toBe('max-age=31536000');
    } finally {
      await app.close();
    }
  });
});

describe('the desktop lock (plan 7.4)', () => {
  const TOKEN = 'a'.repeat(43);
  let dir: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'st-web-'));
    await writeFile(join(dir, 'index.html'), '<!doctype html><html><body><app-root></app-root></body></html>');
    app = await buildApp({ db: testDb(), clock: fixedClock, webDist: dir, desktopToken: TOKEN });
  });
  afterAll(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const ask = (url: string, headers: Record<string, string>) => app.inject({ method: 'GET', url, headers });

  it('the window (its cookie, this PC as the host) gets the app and the API', async () => {
    const cookie = `other=1; vtiger-reader-desktop=${TOKEN}`;
    expect((await ask('/api/health', { host: '127.0.0.1:52411', cookie })).statusCode).toBe(200);
    expect((await ask('/', { host: 'localhost:52411', cookie })).statusCode).toBe(200);
  });

  it('anything else gets a 403, the web build too: no cookie, a wrong one, another host', async () => {
    const attempts: Array<Record<string, string>> = [
      { host: '127.0.0.1:52411' },
      { host: '127.0.0.1:52411', cookie: `vtiger-reader-desktop=${'b'.repeat(43)}` },
      { host: '127.0.0.1:52411', cookie: 'vtiger-reader-desktop=short' },
      // a site that points its own name at 127.0.0.1 (DNS rebinding)
      { host: 'evil.example:52411', cookie: `vtiger-reader-desktop=${TOKEN}` },
    ];
    for (const headers of attempts) {
      for (const url of ['/api/settings', '/', '/index.html']) {
        const res = await ask(url, headers);
        expect(res.statusCode, `${url} ${JSON.stringify(headers)}`).toBe(403);
        expect(String(res.headers['content-type'])).toContain('application/problem+json');
      }
    }
  });

  it('a token too short to be a secret is refused when the app is built', async () => {
    await expect(buildApp({ db: testDb(), desktopToken: 'short' })).rejects.toThrow(/at least 32/);
  });
});
