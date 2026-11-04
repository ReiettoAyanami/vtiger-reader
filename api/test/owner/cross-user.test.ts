import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApi, type Api, type Res } from '../support/api.js';
import { rawRows } from '../support/db.js';
import { FakeCrm } from '../support/fake-crm.js';
import { browserSubscription } from '../support/fake-push.js';
import { OTHER, TESTER, idOf } from '../support/session.js';

/**
 * Another user's things do not exist (design-accounts.md, "Non-Negotiable Constraints": "the same
 * 404 for another user's page or id as for something that does not exist"; the first risk of the
 * OWASP API Top 10 2023, broken object level authorization).
 *
 * User A changes what is theirs. User B calls every route of the API, as the API itself
 * lists them, with A's ids: each answers exactly as it does for ids that do not exist, nothing of
 * A shows in B's answers, and A's data is the same afterwards. A route added without a case here
 * fails the suite.
 */

interface Ids {
  user: number;
  list: number;
  provider: number;
}

const MISSING: Ids = { user: 999993, list: 999994, provider: 999995 };
const SECRET = 'A-secret';
/** A's CRM access key: never in an answer, not even A's own. */
const A_KEY = 'AbCdEf0123456789';
const CRM_URL = new FakeCrm().url;
/** A's browser: B can neither read nor remove it. */
const A_BROWSER = browserSubscription('https://push.example.com/send/a-browser');
/** A's AI key: never in an answer, not even A's own. */
const A_AI_KEY = 'sk-a-secret-key-000000';

type Call = (as: Api, ids: Ids) => Promise<Res>;
/**
 * like-missing: A's ids answer as missing ids do. own: B's own data, nothing of A in it. hidden: an
 * administrator's route, which for B, a user, answers as a route that does not exist.
 */
type Case =
  | { kind: 'like-missing'; call: Call; echoesInput?: boolean }
  | { kind: 'own'; call: (as: Api) => Promise<Res> }
  | { kind: 'hidden'; call: Call };

const own = (call: (as: Api) => Promise<Res>): Case => ({ kind: 'own', call });
const like = (call: Call, echoesInput = false): Case => ({ kind: 'like-missing', call, echoesInput });
const hidden = (call: Call): Case => ({ kind: 'hidden', call });

/**
 * Every private route of the API, "METHOD /url" as registered, and what B does with it. Each step
 * that adds a route adds its case here (the CRM link, AI providers, image marks...).
 */
const CASES: Record<string, Case[]> = {
  // Settings
  'GET /api/settings': [own((b) => b.get('/api/settings'))],
  'PATCH /api/settings': [own((b) => b.patch('/api/settings', { timezone: 'America/Lima' }))],
  // The CRM link: B links, reads and unlinks B's own account
  'PUT /api/crm/link': [own((b) => b.put('/api/crm/link', { url: CRM_URL, username: 'anna.bianchi', accessKey: 'ZyXwVu9876543210' }))],
  'GET /api/crm/link': [own((b) => b.get('/api/crm/link'))],
  'DELETE /api/crm/link': [own((b) => b.del('/api/crm/link'))],
  // Tickets: read from the CRM with B's own account (B unlinked above: each answers B's "not
  // linked"); nothing of A's in them. A's image marks are A's: B's mark changes none of them.
  'GET /api/tickets/options': [own((b) => b.get('/api/tickets/options'))],
  // AI: A's provider ids answer as missing ones; A's key never shows
  'GET /api/ai/providers': [own((b) => b.get('/api/ai/providers'))],
  'POST /api/ai/providers': [own((b) => b.post('/api/ai/providers', { kind: 'ollama', label: 'B local', baseUrl: 'https://ollama.example.com' }))],
  'PUT /api/ai/providers/:id': [like((b, i) => b.put(`/api/ai/providers/${i.provider}`, { kind: 'openai', label: SECRET, apiKey: 'sk-b-00000000000' }), true)],
  'DELETE /api/ai/providers/:id': [like((b, i) => b.del(`/api/ai/providers/${i.provider}`))],
  'GET /api/ai/providers/:id/models': [like((b, i) => b.get(`/api/ai/providers/${i.provider}/models`))],
  'GET /api/ai/tasks': [own((b) => b.get('/api/ai/tasks'))],
  'PUT /api/ai/tasks': [like((b, i) => b.put('/api/ai/tasks', { default: { providerId: i.provider, model: 'x' } }))],
  'GET /api/ai/usage': [own((b) => b.get('/api/ai/usage'))],
  'POST /api/tickets/:id/ai': [own((b) => b.post('/api/tickets/17x1/ai', { task: 'summary' }))],
  // Lists: A's list ids answer as missing ones
  'GET /api/lists': [own((b) => b.get('/api/lists'))],
  'GET /api/lists/counts': [own((b) => b.get('/api/lists/counts'))],
  'POST /api/lists': [own((b) => b.post('/api/lists', { name: 'B list', filter: { owner: 'me', status: 'any' } }))],
  'PUT /api/lists/order': [like((b, i) => b.put('/api/lists/order', { ids: [i.list] }))],
  'PUT /api/lists/:id': [like((b, i) => b.put(`/api/lists/${i.list}`, { name: SECRET, filter: { owner: 'me', status: 'any' } }), true)],
  'DELETE /api/lists/:id': [like((b, i) => b.del(`/api/lists/${i.list}`))],
  'GET /api/names': [own((b) => b.get('/api/names?ids=11x1'))],
  'GET /api/tickets': [own((b) => b.get('/api/tickets')), like((b, i) => b.get(`/api/tickets?list=${i.list}`))],
  'GET /api/tickets/:id': [own((b) => b.get('/api/tickets/17x1'))],
  'GET /api/tickets/:id/attachments': [own((b) => b.get('/api/tickets/17x1/attachments'))],
  'GET /api/tickets/:id/files/:fileId': [own((b) => b.get('/api/tickets/17x1/files/15x1'))],
  'PUT /api/tickets/:id/files/:fileId/mark': [own((b) => b.put('/api/tickets/17x1/files/15x1/mark', { mark: null }))],
  'GET /api/customers': [own((b) => b.get('/api/customers?q=rossi'))],
  // Notifications: B's own settings, bell and stream; A's lists answer as missing ones; A's
  // browser is not B's to remove (A's rows are checked unchanged at the end)
  'GET /api/notifications/settings': [own((b) => b.get('/api/notifications/settings'))],
  'PUT /api/notifications/settings': [like((b, i) => b.put('/api/notifications/settings', { enabled: true, lists: [i.list] }))],
  'GET /api/notifications': [own((b) => b.get('/api/notifications'))],
  'POST /api/notifications/seen': [own((b) => b.post('/api/notifications/seen', { upTo: '2026-09-29T09:00:00Z' }))],
  'GET /api/notifications/stream': [own((b) => b.stream('/api/notifications/stream', 'event: ready'))],
  'GET /api/push/key': [own((b) => b.get('/api/push/key'))],
  'PUT /api/push/subscription': [own((b) => b.put('/api/push/subscription', browserSubscription()))],
  'POST /api/push/subscription/delete': [own((b) => b.post('/api/push/subscription/delete', { endpoint: A_BROWSER.endpoint }))],
  'POST /api/push/test': [own((b) => b.post('/api/push/test'))],
  // B's own account (a wrong current password: nothing changes for the next cases)
  'POST /api/account/password': [own((b) => b.post('/api/account/password', { currentPassword: 'not-mine-0000!', newPassword: 'Taken-pass-00001' }))],
  // Admin: B is no administrator
  'GET /api/admin/users': [hidden((b) => b.get('/api/admin/users'))],
  'POST /api/admin/users': [hidden((b) => b.post('/api/admin/users', { username: 'b-made', email: 'b@dev.invalid', password: 'B-made-pass-0001', role: 'admin' }))],
  'PATCH /api/admin/users/:id': [hidden((b, i) => b.patch(`/api/admin/users/${i.user}`, { password: 'Taken-pass-00001', blocked: true }))],
  'DELETE /api/admin/users/:id': [hidden((b, i) => b.del(`/api/admin/users/${i.user}`))],
  'POST /api/admin/users/:id/impersonate': [hidden((b, i) => b.post(`/api/admin/users/${i.user}/impersonate`))],
  'GET /api/admin/generated-password': [hidden((b) => b.get('/api/admin/generated-password'))],
};

/** Routes anyone may call: no user's data behind them. */
const PUBLIC = ['GET /api/health', 'GET /api/version'];

let api: Api;
beforeAll(async () => {
  api = await makeApi({ crm: new FakeCrm() });
});
afterAll(async () => {
  await api.app.close();
});

async function recordA(): Promise<Ids> {
  expect((await api.patch('/api/settings', { timezone: 'Europe/London' })).status).toBe(200);
  expect((await api.put('/api/crm/link', { url: CRM_URL, username: 'mario.rossi', accessKey: A_KEY })).status).toBe(200);
  const aId = await idOf(api.app, TESTER);
  await rawRows("INSERT INTO image_mark (user_id, exact_hash, dhash, ratio, mark) VALUES (?, REPEAT('a', 64), REPEAT('b', 16), 3, 'logo')", [aId]);
  const list = (await api.post('/api/lists', { name: SECRET, filter: { owner: 'me', status: 'any' } })).body.id as number;
  const provider = (await api.post('/api/ai/providers', { kind: 'openai', label: SECRET, apiKey: A_AI_KEY })).body.id as number;
  await api.put('/api/ai/tasks', { default: { providerId: provider, model: 'gpt-x' } });
  expect((await api.put('/api/notifications/settings', { enabled: false, lists: [list] })).status).toBe(200);
  expect((await api.put('/api/push/subscription', A_BROWSER)).status).toBe(204);
  return { user: await idOf(api.app, TESTER), list, provider };
}

/** Every row of a user's own data, as stored. */
async function dataOf(userId: number) {
  return {
    settings: await rawRows('SELECT * FROM user_settings WHERE user_id = ?', [userId]),
    crmLink: await rawRows('SELECT * FROM crm_link WHERE user_id = ?', [userId]),
    imageMarks: await rawRows('SELECT * FROM image_mark WHERE user_id = ?', [userId]),
    lists: await rawRows('SELECT * FROM ticket_list WHERE user_id = ? ORDER BY id', [userId]),
    aiProviders: await rawRows('SELECT * FROM ai_provider WHERE user_id = ? ORDER BY id', [userId]),
    aiTasks: await rawRows('SELECT * FROM ai_task_model WHERE user_id = ? ORDER BY id', [userId]),
    notifications: await rawRows('SELECT * FROM notification_state WHERE user_id = ?', [userId]),
    browsers: await rawRows('SELECT * FROM push_subscription WHERE user_id = ? ORDER BY id', [userId]),
  };
}

/** What two answers must share to be "the same": status, and the problem's type or the whole body. */
function shape(res: Res): unknown {
  if (res.status >= 400) return { status: res.status, type: (res.body as { type?: unknown })?.type };
  return { status: res.status, body: res.body };
}

describe('another user', () => {
  it('every private route of the API has a case here, and every case a route', () => {
    const routes = api.app.apiRoutes.map((r) => `${r.method} ${r.url}`).filter((r) => !r.startsWith('GET /api/auth/') && !r.startsWith('POST /api/auth/'));
    const privateRoutes = routes.filter((r) => !PUBLIC.includes(r));
    expect([...new Set(privateRoutes)].sort()).toEqual(Object.keys(CASES).sort());
  });

  it("finds none of A's things, by any route, and changes none of them", async () => {
    const a = await recordA();
    const aId = await idOf(api.app, TESTER);
    const before = await dataOf(aId);
    const b = api.as(OTHER);

    for (const [route, cases] of Object.entries(CASES)) {
      for (const c of cases) {
        if (c.kind === 'own') {
          const res = await c.call(b);
          expect(res.status, `${route}: ${JSON.stringify(res.body)}`).toBeLessThan(500);
          expect(JSON.stringify(res.body), route).not.toContain(SECRET);
          expect(JSON.stringify(res.body), route).not.toContain('mario.rossi');
          expect(JSON.stringify(res.body), route).not.toContain(A_KEY);
          expect(JSON.stringify(res.body), route).not.toContain(A_AI_KEY);
        } else if (c.kind === 'hidden') {
          for (const ids of [a, MISSING]) {
            expect(shape(await c.call(b, ids)), route).toEqual({ status: 404, type: 'urn:vtiger-reader:problem:not-found' });
          }
        } else {
          const withA = await c.call(b, a);
          const withMissing = await c.call(b, MISSING);
          expect(shape(withA), route).toEqual(shape(withMissing));
          expect(withA.status, `${route}: ${JSON.stringify(withA.body)}`).toBeGreaterThanOrEqual(400);
          if (!c.echoesInput) expect(JSON.stringify(withA.body), route).not.toContain(SECRET);
        }
      }
    }

    expect(await dataOf(aId)).toEqual(before);
    // A's account too: same role, not blocked, still signed in; and B made nobody
    expect(await rawRows('SELECT username, role, banned FROM users ORDER BY id')).toEqual([
      { username: 'tester', role: 'user', banned: 0 },
      { username: 'other-user', role: 'user', banned: 0 },
    ]);
    expect((await api.get('/api/settings')).status).toBe(200);
    expect((await api.get('/api/crm/link')).body).toMatchObject({ linked: true, username: 'mario.rossi', problem: null });
    // B's own settings are B's: the defaults, then B's own change
    expect((await b.get('/api/settings')).body).toEqual({ language: 'en', timezone: 'America/Lima' });
  });
});
