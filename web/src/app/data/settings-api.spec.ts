import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';

import { SettingsApi } from './settings-api';

describe('SettingsApi', () => {
  let api: SettingsApi;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(SettingsApi);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('gets the settings', async () => {
    const settings = { language: 'en' as const, timezone: 'Europe/Rome' };
    const result = firstValueFrom(api.getSettings());
    const req = backend.expectOne('/api/settings');
    expect(req.request.method).toBe('GET');
    req.flush(settings);
    expect(await result).toEqual(settings);
  });

  it('changes what is sent, and answers with every setting', async () => {
    const saved = { language: 'en' as const, timezone: 'Europe/London' };
    const result = firstValueFrom(api.updateSettings({ timezone: 'Europe/London' }));
    const req = backend.expectOne('/api/settings');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ timezone: 'Europe/London' });
    req.flush(saved);
    expect(await result).toEqual(saved);
  });
});
