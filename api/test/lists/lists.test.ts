import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectProblem, makeApi, type Api } from '../support/api.js';
import { rawRows } from '../support/db.js';

let api: Api;
beforeAll(async () => {
  api = await makeApi();
});
afterAll(async () => {
  await api.app.close();
});

const names = async (as: Api = api) => ((await as.get('/api/lists')).body as Array<{ name: string }>).map((l) => l.name);

describe('/api/lists', () => {
  it('a new user starts with the default lists, in order', async () => {
    const res = await api.get('/api/lists');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: expect.any(Number), name: 'My tickets', filter: { owner: 'me', status: 'any' } },
      { id: expect.any(Number), name: 'My open tickets', filter: { owner: 'me', status: 'open' } },
      { id: expect.any(Number), name: 'My closed tickets', filter: { owner: 'me', status: 'closed' } },
      { id: expect.any(Number), name: 'Unassigned', filter: { owner: 'groups', status: 'open' } },
      { id: expect.any(Number), name: 'All open tickets', filter: { owner: 'anyone', status: 'open' } },
      { id: expect.any(Number), name: 'All tickets', filter: { owner: 'anyone', status: 'any' } },
    ]);
  });

  it('creates a list, last; what does not belong to its choices is dropped', async () => {
    const res = await api.post('/api/lists', {
      name: '  Hardware,  open ',
      filter: { owner: 'anyone', group: '20x1', status: 'open', statusValue: 'Open', picks: { ticketcategories: 'Hardware' } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({ id: expect.any(Number), name: 'Hardware, open', filter: { owner: 'anyone', status: 'open', picks: { ticketcategories: 'Hardware' } } });
    expect((await names()).at(-1)).toBe('Hardware, open');
  });

  it('edits a list: its name and its filter', async () => {
    const id = (await api.post('/api/lists', { name: 'Mine', filter: { owner: 'me', status: 'any' } })).body.id;
    const res = await api.put(`/api/lists/${id}`, { name: 'Group one', filter: { owner: 'group', group: '20x1', status: 'one', statusValue: 'Open' } });
    expect(res.body).toEqual({ id, name: 'Group one', filter: { owner: 'group', group: '20x1', status: 'one', statusValue: 'Open' } });
    // the same again: unchanged, still there
    expect((await api.put(`/api/lists/${id}`, { name: 'Group one', filter: res.body.filter })).status).toBe(200);
  });

  it('orders the lists: each of them, once', async () => {
    const ids = ((await api.get('/api/lists')).body as Array<{ id: number }>).map((l) => l.id);
    const reversed = [...ids].reverse();
    expect(((await api.put('/api/lists/order', { ids: reversed })).body as Array<{ id: number }>).map((l) => l.id)).toEqual(reversed);
    expectProblem(await api.put('/api/lists/order', { ids: reversed.slice(1) }), 400);
    expectProblem(await api.put('/api/lists/order', { ids: [...reversed, reversed[0]] }), 400);
  });

  it('deletes a list', async () => {
    const id = (await api.post('/api/lists', { name: 'Short-lived', filter: { owner: 'me', status: 'any' } })).body.id;
    expect((await api.del(`/api/lists/${id}`)).status).toBe(204);
    expect(await names()).not.toContain('Short-lived');
    expectProblem(await api.del(`/api/lists/${id}`), 404, 'not-found');
  });

  it('validates: a name, a known owner and status, the group or status they need', async () => {
    expectProblem(await api.post('/api/lists', { name: ' ', filter: { owner: 'me', status: 'any' } }), 400);
    expectProblem(await api.post('/api/lists', { name: 'x', filter: { owner: 'boss', status: 'any' } }), 400);
    expectProblem(await api.post('/api/lists', { name: 'x', filter: { owner: 'group', status: 'any' } }), 400);
    expectProblem(await api.post('/api/lists', { name: 'x', filter: { owner: 'me', status: 'one' } }), 400);
    expectProblem(await api.post('/api/lists', { name: 'x', filter: { owner: 'me', status: 'any', picks: { ticketstatus: 'Open' } } }), 400);
    expectProblem(await api.post('/api/lists', { name: 'x', filter: { owner: 'me', status: 'any', picks: { 'bad field': 'x' } } }), 400);
    expectProblem(await api.post('/api/lists', { name: 'x', filter: { owner: 'me', status: 'any' }, shared: true }), 400);
  });

  it('a list that does not exist is not found, and nothing changes', async () => {
    const mine = (await api.post('/api/lists', { name: 'Mine', filter: { owner: 'me', status: 'any' } })).body.id;
    expectProblem(await api.put(`/api/lists/${mine + 100}`, { name: 'Taken', filter: { owner: 'me', status: 'any' } }), 404, 'not-found');
    expectProblem(await api.del(`/api/lists/${mine + 100}`), 404, 'not-found');
    expect(await rawRows('SELECT name FROM ticket_list WHERE id = ?', [mine])).toEqual([{ name: 'Mine' }]);
  });
});
