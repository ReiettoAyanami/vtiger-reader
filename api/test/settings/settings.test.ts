import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectProblem, makeApi, type Api } from '../support/api.js';

let api: Api;
beforeAll(async () => {
  api = await makeApi();
});
afterAll(async () => {
  await api.app.close();
});

describe('/api/settings', () => {
  it('returns the defaults', async () => {
    const res = await api.get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ language: 'en', timezone: 'Europe/Rome' });
  });

  it('updates the time zone, keeps the language', async () => {
    const res = await api.patch('/api/settings', { timezone: 'America/New_York' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ language: 'en', timezone: 'America/New_York' });
    expect((await api.patch('/api/settings', { language: 'en' })).body).toEqual({ language: 'en', timezone: 'America/New_York' });
    expect((await api.get('/api/settings')).body).toEqual({ language: 'en', timezone: 'America/New_York' });
  });

  it('validates: a real time zone, an available language, known fields only', async () => {
    expectProblem(await api.patch('/api/settings', { timezone: 'Mars/Olympus' }), 400);
    expectProblem(await api.patch('/api/settings', { language: 'it' }), 400); // English only, for now
    expectProblem(await api.patch('/api/settings', {}), 400);
    expectProblem(await api.patch('/api/settings', { currency: 'EUR' }), 400);
  });
});
