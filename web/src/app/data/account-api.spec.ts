import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { AccountApi } from './account-api';

describe('AccountApi', () => {
  let api: AccountApi;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(AccountApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('changePassword posts the current and the new password', async () => {
    const done = firstValueFrom(api.changePassword('Lenzi-pass-0001', 'Lenzi-pass-0002'));
    const req = backend.expectOne({ method: 'POST', url: '/api/account/password' });
    expect(req.request.body).toEqual({ currentPassword: 'Lenzi-pass-0001', newPassword: 'Lenzi-pass-0002' });
    req.flush(null, { status: 204, statusText: 'No Content' });

    await expect(done).resolves.toBeUndefined();
  });
});
