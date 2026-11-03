import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { AuthApi } from './auth-api';

describe('AuthApi', () => {
  let api: AuthApi;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(AuthApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('getSession: who is signed in, with the role and the impersonating administrator', async () => {
    const answer = firstValueFrom(api.getSession());
    backend.expectOne({ method: 'GET', url: '/api/auth/get-session' }).flush({
      session: { id: 9, userId: '2', expiresAt: '2026-11-02T09:00:00.000Z', impersonatedBy: '1' },
      user: { id: '2', username: 'test-user', email: 'test@example.invalid', role: 'user', banned: false },
    });

    expect(await answer).toEqual({ id: 2, username: 'test-user', role: 'user', impersonatedBy: 1 });
  });

  it('getSession: an administrator on their own; nobody is null', async () => {
    const admin = firstValueFrom(api.getSession());
    backend.expectOne('/api/auth/get-session').flush({ session: { impersonatedBy: null }, user: { id: 1, username: 'lenzi', role: 'admin' } });
    expect(await admin).toEqual({ id: 1, username: 'lenzi', role: 'admin', impersonatedBy: null });

    const nobody = firstValueFrom(api.getSession());
    backend.expectOne('/api/auth/get-session').flush(null);
    expect(await nobody).toBeNull();
  });

  it('signIn posts the username and the password as JSON', async () => {
    const done = firstValueFrom(api.signIn('lenzi', 'Lenzi-pass-0001'));
    const req = backend.expectOne({ method: 'POST', url: '/api/auth/sign-in/username' });
    expect(req.request.body).toEqual({ username: 'lenzi', password: 'Lenzi-pass-0001' });
    req.flush({ redirect: false, user: { id: 1, username: 'lenzi' } });

    await expect(done).resolves.toBeUndefined();
  });

  it('revokeOtherSessions posts an empty JSON body', async () => {
    const done = firstValueFrom(api.revokeOtherSessions());
    const req = backend.expectOne({ method: 'POST', url: '/api/auth/revoke-other-sessions' });
    expect(req.request.body).toEqual({});
    req.flush({ status: true });

    await expect(done).resolves.toBeUndefined();
  });

  it('stopImpersonating posts an empty JSON body', async () => {
    const done = firstValueFrom(api.stopImpersonating());
    const req = backend.expectOne({ method: 'POST', url: '/api/auth/admin/stop-impersonating' });
    expect(req.request.body).toEqual({});
    req.flush({ session: {}, user: { id: 1, username: 'lenzi' } });

    await expect(done).resolves.toBeUndefined();
  });

  it('signOut posts an empty JSON body', async () => {
    const done = firstValueFrom(api.signOut());
    const req = backend.expectOne({ method: 'POST', url: '/api/auth/sign-out' });
    expect(req.request.body).toEqual({});
    req.flush({ success: true });

    await expect(done).resolves.toBeUndefined();
  });
});
