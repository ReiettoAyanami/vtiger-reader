import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { expectProblem, makeApi, type Api } from '../support/api.js';
import { rawRows } from '../support/db.js';
import { FakeCrm } from '../support/fake-crm.js';
import { OTHER, TESTER, idOf } from '../support/session.js';

const MARIO = { username: 'mario.rossi', accessKey: 'AbCdEf0123456789' };
const ANNA = { username: 'anna.bianchi', accessKey: 'ZyXwVu9876543210' };

const UNLINKED = { linked: false, username: null, linkedAt: null, lastLoginAt: null, problem: null };

const apps: Api[] = [];
async function start(opts: Parameters<typeof makeApi>[0] = {}): Promise<Api> {
  const api = await makeApi(opts);
  apps.push(api);
  return api;
}
afterEach(async () => {
  for (const api of apps.splice(0)) await api.app.close();
});

describe('/api/crm/link', () => {
  it('starts unlinked, with the CRM address of the instance', async () => {
    const crm = new FakeCrm();
    const api = await start({ crm });
    expect((await api.get('/api/crm/link')).body).toEqual({ crmUrl: crm.url, ...UNLINKED });
    expect(crm.calls).toEqual([]);
  });

  it('links after a real login; the key is stored sealed and never sent back', async () => {
    const crm = new FakeCrm();
    const api = await start({ crm });
    const res = await api.put('/api/crm/link', MARIO);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      crmUrl: crm.url,
      linked: true,
      username: 'mario.rossi',
      linkedAt: expect.any(String),
      lastLoginAt: expect.any(String),
      problem: null,
    });
    expect(crm.operations()).toEqual(['getchallenge', 'login']);

    const rows = await rawRows('SELECT crm_username, access_key_sealed, crm_user_id FROM crm_link WHERE user_id = ?', [
      await idOf(api.app, TESTER),
    ]);
    expect(rows).toEqual([{ crm_username: 'mario.rossi', access_key_sealed: expect.stringMatching(/^v1\./), crm_user_id: '19x5' }]);
    expect(JSON.stringify(rows)).not.toContain(MARIO.accessKey);
    expect(JSON.stringify((await api.get('/api/crm/link')).body)).not.toContain(MARIO.accessKey);
  });

  it('a key the CRM refuses is a field error, and nothing is stored', async () => {
    const api = await start({ crm: new FakeCrm() });
    const res = await api.put('/api/crm/link', { ...MARIO, accessKey: 'WrongKey00000000' });
    expectProblem(res, 400, 'validation');
    expect(res.body.errors).toEqual([{ field: 'accessKey', message: 'The CRM did not accept this username and access key' }]);
    expect(await rawRows('SELECT COUNT(*) AS n FROM crm_link')).toEqual([{ n: 0 }]);
  });

  it('validates the body: both fields, nothing else, a key without spaces inside', async () => {
    const api = await start({ crm: new FakeCrm() });
    expectProblem(await api.put('/api/crm/link', { username: 'mario.rossi' }), 400);
    expectProblem(await api.put('/api/crm/link', { ...MARIO, url: 'https://elsewhere.example' }), 400);
    expectProblem(await api.put('/api/crm/link', { ...MARIO, accessKey: 'two words' }), 400);
    expectProblem(await api.put('/api/crm/link', { username: '   ', accessKey: MARIO.accessKey }), 400);
  });

  it('a CRM that does not answer is a 503, and nothing is stored', async () => {
    const crm = new FakeCrm();
    crm.down = true;
    const api = await start({ crm });
    expectProblem(await api.put('/api/crm/link', MARIO), 503, 'crm-unreachable');
    expect(await rawRows('SELECT COUNT(*) AS n FROM crm_link')).toEqual([{ n: 0 }]);
  });

  it('an instance without CRM_URL says so', async () => {
    const api = await start();
    expect((await api.get('/api/crm/link')).body).toEqual({ crmUrl: null, ...UNLINKED });
    expectProblem(await api.put('/api/crm/link', MARIO), 409, 'crm-not-configured');
  });

  it('linking again replaces the account: one link per user', async () => {
    const api = await start({ crm: new FakeCrm() });
    await api.put('/api/crm/link', MARIO);
    expect((await api.put('/api/crm/link', ANNA)).body).toMatchObject({ linked: true, username: 'anna.bianchi' });
    expect(await rawRows('SELECT crm_username, crm_user_id FROM crm_link')).toEqual([{ crm_username: 'anna.bianchi', crm_user_id: '19x7' }]);
  });

  it('unlinking deletes the row; unlinking again is fine', async () => {
    const api = await start({ crm: new FakeCrm() });
    await api.put('/api/crm/link', MARIO);
    expect((await api.del('/api/crm/link')).status).toBe(204);
    expect(await rawRows('SELECT COUNT(*) AS n FROM crm_link')).toEqual([{ n: 0 }]);
    expect((await api.del('/api/crm/link')).status).toBe(204);
    expect((await api.get('/api/crm/link')).body).toMatchObject(UNLINKED);
  });

  it("a sealed key opens only for its own user, and only with the server's key", async () => {
    const crm = new FakeCrm();
    const api = await start({ crm });
    await api.put('/api/crm/link', MARIO);
    // A's sealed key copied into B's row does not open for B.
    const b = api.as(OTHER);
    await b.put('/api/crm/link', ANNA);
    const [a] = await rawRows('SELECT access_key_sealed FROM crm_link WHERE user_id = ?', [await idOf(api.app, TESTER)]);
    await rawRows('UPDATE crm_link SET access_key_sealed = ? WHERE user_id = ?', [a?.access_key_sealed, await idOf(api.app, OTHER)]);
    expect((await b.get('/api/crm/link')).body.problem).toMatch(/link the account again/);
    expect((await api.get('/api/crm/link')).body.problem).toBeNull();

    // Another ENCRYPTION_KEY: the link is there, and says it must be made again.
    const rekeyed = await start({ crm, encryptionKey: randomBytes(32) });
    expect((await rekeyed.get('/api/crm/link')).body).toMatchObject({ linked: true, problem: expect.stringMatching(/encryption key/) });
  });

  it('needs a signed-in user', async () => {
    const api = await start({ crm: new FakeCrm() });
    expectProblem(await api.as(null).get('/api/crm/link'), 401);
    expectProblem(await api.as(null).put('/api/crm/link', MARIO), 401);
  });
});
