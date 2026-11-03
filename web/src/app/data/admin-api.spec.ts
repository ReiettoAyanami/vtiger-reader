import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { AdminApi } from './admin-api';
import { User } from './user';

const friend: User = {
  id: 7,
  username: 'friend',
  email: 'friend@dev.invalid',
  role: 'user',
  blocked: false,
  hasPassword: true,
  createdAt: '2026-10-03T09:00:00Z',
};

describe('AdminApi', () => {
  let api: AdminApi;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(AdminApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('listUsers: GET /api/admin/users', async () => {
    const answer = firstValueFrom(api.listUsers());
    backend.expectOne({ method: 'GET', url: '/api/admin/users' }).flush([friend]);
    expect(await answer).toEqual([friend]);
  });

  it('createUser: POST with the user', async () => {
    const input = { username: 'friend', email: 'friend@dev.invalid', password: 'Friend-pass-0001', role: 'user' as const };
    const answer = firstValueFrom(api.createUser(input));
    const req = backend.expectOne({ method: 'POST', url: '/api/admin/users' });
    expect(req.request.body).toEqual(input);
    req.flush(friend, { status: 201, statusText: 'Created' });
    expect(await answer).toEqual(friend);
  });

  it('updateUser: PATCH with only the changes', async () => {
    const answer = firstValueFrom(api.updateUser(7, { blocked: true }));
    const req = backend.expectOne({ method: 'PATCH', url: '/api/admin/users/7' });
    expect(req.request.body).toEqual({ blocked: true });
    req.flush({ ...friend, blocked: true });
    expect((await answer).blocked).toBe(true);
  });

  it('deleteUser: DELETE', async () => {
    const answer = firstValueFrom(api.deleteUser(7));
    backend.expectOne({ method: 'DELETE', url: '/api/admin/users/7' }).flush(null, { status: 204, statusText: 'No Content' });
    await expect(answer).resolves.toBeNull();
  });

  it('impersonate: POST with an empty JSON body', async () => {
    const answer = firstValueFrom(api.impersonate(7));
    const req = backend.expectOne({ method: 'POST', url: '/api/admin/users/7/impersonate' });
    expect(req.request.body).toEqual({});
    req.flush({ user: friend });
    await expect(answer).resolves.toBeUndefined();
  });

  it('generatedPassword: the password of the answer', async () => {
    const answer = firstValueFrom(api.generatedPassword());
    backend.expectOne({ method: 'GET', url: '/api/admin/generated-password' }).flush({ password: 'Gen-erated-pass-42' });
    expect(await answer).toBe('Gen-erated-pass-42');
  });
});
