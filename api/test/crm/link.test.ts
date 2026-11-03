import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { isPublicHost } from '../../src/shared/public-host.js';
import { expectProblem, makeApi, type Api } from '../support/api.js';
import { rawRows } from '../support/db.js';
import { FakeCrm } from '../support/fake-crm.js';
import { OTHER, TESTER, idOf } from '../support/session.js';

const CRM_URL = new FakeCrm().url;
const MARIO = { url: CRM_URL, username: 'mario.rossi', accessKey: 'AbCdEf0123456789' };
const ANNA = { url: CRM_URL, username: 'anna.bianchi', accessKey: 'ZyXwVu9876543210' };

const UNLINKED = { crmUrl: null, linked: false, username: null, linkedAt: null, lastLoginAt: null, problem: null };

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
  it('starts unlinked', async () => {
    const crm = new FakeCrm();
    const api = await start({ crm });
    expect((await api.get('/api/crm/link')).body).toEqual(UNLINKED);
    expect(crm.calls).toEqual([]);
  });

  it('links after a real login; the key is stored sealed and never sent back', async () => {
    const crm = new FakeCrm();
    const api = await start({ crm });
    // The address as typed, stored as the CRM's base address.
    const res = await api.put('/api/crm/link', { ...MARIO, url: `${crm.url}/webservice.php` });
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

    const rows = await rawRows('SELECT crm_url, crm_username, access_key_sealed, crm_user_id FROM crm_link WHERE user_id = ?', [
      await idOf(api.app, TESTER),
    ]);
    expect(rows).toEqual([{ crm_url: crm.url, crm_username: 'mario.rossi', access_key_sealed: expect.stringMatching(/^v1\./), crm_user_id: '19x5' }]);
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

  it('validates the body: the three fields, nothing else, a key without spaces inside', async () => {
    const api = await start({ crm: new FakeCrm() });
    expectProblem(await api.put('/api/crm/link', { url: CRM_URL, username: 'mario.rossi' }), 400);
    expectProblem(await api.put('/api/crm/link', { username: 'mario.rossi', accessKey: MARIO.accessKey }), 400);
    expectProblem(await api.put('/api/crm/link', { ...MARIO, port: 8443 }), 400);
    expectProblem(await api.put('/api/crm/link', { ...MARIO, accessKey: 'two words' }), 400);
    expectProblem(await api.put('/api/crm/link', { username: '   ', accessKey: MARIO.accessKey }), 400);
  });

  it('an address where no CRM answers: said under the address, nothing stored', async () => {
    const crm = new FakeCrm();
    crm.down = true;
    const api = await start({ crm });
    const res = await api.put('/api/crm/link', MARIO);
    expectProblem(res, 400, 'validation');
    expect(res.body.errors[0]).toEqual({ field: 'url', message: 'No CRM answers at this address: The CRM does not answer' });
    expect(await rawRows('SELECT COUNT(*) AS n FROM crm_link')).toEqual([{ n: 0 }]);
  });

  it('the address must be https, on a public host: nothing is sent anywhere else', async () => {
    const crm = new FakeCrm();
    const api = await start({ crm, hostAllowed: async (host) => host === 'crm.example.invalid' });
    for (const url of ['http://crm.example.invalid', 'crm.example.invalid', 'https://192.168.1.10', 'https://intranet.example.invalid']) {
      const res = await api.put('/api/crm/link', { ...MARIO, url });
      expectProblem(res, 400, 'validation');
      expect(res.body.errors.map((e: { field: string }) => e.field), url).toEqual(['url']);
    }
    expect(crm.calls).toEqual([]);
    expect(await rawRows('SELECT COUNT(*) AS n FROM crm_link')).toEqual([{ n: 0 }]);
  });

  it('the real check refuses this machine and the LAN (no network needed)', async () => {
    const api = await start({ crm: new FakeCrm(), hostAllowed: isPublicHost });
    for (const url of ['https://127.0.0.1', 'https://localhost', 'https://10.0.0.5', 'https://[::1]', 'https://169.254.169.254']) {
      expect((await api.put('/api/crm/link', { ...MARIO, url })).body.errors?.[0]?.field, url).toBe('url');
    }
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
    expect((await api.get('/api/crm/link')).body).toEqual(UNLINKED);
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
