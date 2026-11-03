import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { CrmLinkStatus } from './crm-link';
import { CrmLinkApi } from './crm-link-api';

const LINKED: CrmLinkStatus = {
  crmUrl: 'https://crm.example.invalid',
  linked: true,
  username: 'mario.rossi',
  linkedAt: '2026-11-03T10:00:00.000Z',
  lastLoginAt: '2026-11-03T10:00:00.000Z',
  problem: null,
};

describe('CrmLinkApi', () => {
  let api: CrmLinkApi;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(CrmLinkApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('gets the link', async () => {
    const result = firstValueFrom(api.getLink());
    const req = backend.expectOne('/api/crm/link');
    expect(req.request.method).toBe('GET');
    req.flush(LINKED);
    expect(await result).toEqual(LINKED);
  });

  it('links with an address, a username and an access key', async () => {
    const result = firstValueFrom(
      api.link({
        url: 'https://crm.example.invalid',
        username: 'mario.rossi',
        accessKey: 'AbCdEf0123456789',
      }),
    );
    const req = backend.expectOne('/api/crm/link');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      url: 'https://crm.example.invalid',
      username: 'mario.rossi',
      accessKey: 'AbCdEf0123456789',
    });
    req.flush(LINKED);
    expect(await result).toEqual(LINKED);
  });

  it('unlinks', async () => {
    const result = firstValueFrom(api.unlink());
    const req = backend.expectOne('/api/crm/link');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(await result).toBeUndefined();
  });
});
