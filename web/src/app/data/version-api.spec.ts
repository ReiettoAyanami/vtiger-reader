import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { VersionApi } from './version-api';

describe('VersionApi', () => {
  let api: VersionApi;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(VersionApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('gets the version of the instance', async () => {
    const result = firstValueFrom(api.getVersion());
    const req = backend.expectOne('/api/version');
    expect(req.request.method).toBe('GET');
    req.flush({ version: 'dev26.0.0' });
    expect(await result).toBe('dev26.0.0');
  });

  it('gets the version and the API level, of this instance or of another address', async () => {
    const here = firstValueFrom(api.getServerVersion());
    backend.expectOne('/api/version').flush({ version: 'a26.1.0', apiLevel: 1 });
    expect(await here).toEqual({ version: 'a26.1.0', apiLevel: 1 });

    const there = firstValueFrom(api.getServerVersion('https://tracker.example.com'));
    backend.expectOne('https://tracker.example.com/api/version').flush({ version: 'v26.2.0', apiLevel: 2 });
    expect(await there).toEqual({ version: 'v26.2.0', apiLevel: 2 });
  });
});
